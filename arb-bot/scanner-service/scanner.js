import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import {
  getNetworkConfig,
  getStrategyConfig,
  getVenuesByType,
  isDryRun,
} from "../config/networks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env before reading any values. `quiet` keeps stdout valid JSON.
for (const envFile of [
  path.resolve(__dirname, "../.env.local"),
  path.resolve(__dirname, "../../contracts/.env"),
  path.resolve(process.cwd(), ".env"),
]) {
  dotenv.config({ path: envFile, quiet: true });
}
dotenv.config({ quiet: true });

const DRY_RUN = isDryRun();
const NETWORK = process.env.NETWORK || "anvil-fork";

let cfg;
let strategy;
try {
  cfg = getNetworkConfig(NETWORK);
  strategy = getStrategyConfig();
} catch (err) {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "config_error",
      message: err.message,
    })
  );
  process.exit(1);
}

const MIN_LOAN_WETH = ethers.parseUnits(strategy.minLoanWeth, 18);
const MAX_LOAN_WETH = ethers.parseUnits(strategy.maxLoanWeth, 18);
const MIN_PROFIT_FLOOR_WETH = ethers.parseUnits(strategy.minProfitFloorWeth, 18);
const GAS_ESTIMATE_UNITS = BigInt(strategy.gasEstimateUnits);

const dbPath = process.env.BOT_DB_PATH
  ? path.resolve(process.env.BOT_DB_PATH)
  : path.resolve(__dirname, "../bot_data.sqlite");
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    network TEXT,
    sushiPrice REAL NOT NULL,
    uniPrice REAL NOT NULL,
    spreadPct REAL NOT NULL,
    loanSizeWeth REAL NOT NULL,
    estimatedProfitWeth REAL NOT NULL,
    thresholdWeth REAL NOT NULL,
    gasPriceGwei REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    network TEXT NOT NULL,
    txHash TEXT,
    status TEXT NOT NULL,
    gasUsed INTEGER,
    elapsedMs INTEGER,
    loanSizeWeth REAL NOT NULL,
    profitWeth REAL
  );
  CREATE TABLE IF NOT EXISTS executions (
    txHash TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    steps TEXT NOT NULL,
    currentStep INTEGER NOT NULL,
    startTime INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
`);
const scanColumns = db
  .prepare("PRAGMA table_info(scans)")
  .all();
if (!scanColumns.some((column) => column.name === "network")) {
  try {
    db.exec("ALTER TABLE scans ADD COLUMN network TEXT");
  } catch {
    // Another process may have migrated the table concurrently.
  }
}
const insertScanStmt = db.prepare(
  "INSERT INTO scans (ts, network, sushiPrice, uniPrice, spreadPct, loanSizeWeth, estimatedProfitWeth, thresholdWeth, gasPriceGwei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
const insertRunStmt = db.prepare(
  "INSERT INTO runs (ts, network, txHash, status, gasUsed, elapsedMs, loanSizeWeth, profitWeth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);

function recordScan(data, ts = Date.now()) {
  return insertScanStmt.run(
    ts,
    cfg.key,
    data.priceA,
    data.priceB,
    data.spreadPct,
    Number(data.loanSizeWeth),
    data.estimatedProfitWeth,
    data.thresholdWeth,
    data.gasPriceGwei
  );
}

function recordRun(data, ts = Date.now()) {
  return insertRunStmt.run(
    ts,
    data.network,
    data.txHash || null,
    data.status,
    data.gasUsed ?? null,
    data.elapsedMs ?? null,
    Number(data.loanSizeWeth || 0),
    data.profitWeth ?? null
  );
}

console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    network: cfg.key,
    event: "db_connected",
    dbPath,
  })
);

const provider = cfg.rpcUrl ? new ethers.JsonRpcProvider(cfg.rpcUrl) : null;
const wallet =
  process.env.PRIVATE_KEY && provider
    ? new ethers.Wallet(process.env.PRIVATE_KEY, provider)
    : null;

const CONTRACT_ABI = [
  "function requestFlashLoan(address token, uint256 amount, bool buyOnA, uint256 minProfit) external",
  "function withdraw(address token) external",
  "function slippageToleranceBps() view returns (uint256)",
  "function dexA() view returns (address)",
  "function dexB() view returns (address)",
  "function tokenB() view returns (address)",
  "event LoanExecuted(address indexed token, uint256 amount, bool buyOnA)",
  "event StepCompleted(string step, uint256 amountOut)",
  "event ArbitrageResult(bool profitable, uint256 profit)",
  "event Withdrawn(address indexed token, uint256 amount)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const FACTORY_ABI = ["function getPair(address,address) external view returns (address)"];
const PAIR_ABI = [
  "function getReserves() external view returns (uint112,uint112,uint32)",
  "function token0() external view returns (address)",
];
const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
];

let venueA = null;
let venueB = null;
let contract = null;
let isExecuting = false;

function log(event, data) {
  const entry = {
    ts: new Date().toISOString(),
    network: cfg.key,
    event,
    ...data,
  };
  console.log(JSON.stringify(entry));
  try {
    if (event === "scan_checked") {
      recordScan(
        {
          priceA: data.priceA,
          priceB: data.priceB,
          spreadPct: data.spreadPct,
          loanSizeWeth: data.loanSizeWeth,
          estimatedProfitWeth: data.estimatedProfitWeth,
          thresholdWeth: data.thresholdWeth,
          gasPriceGwei: data.gasPriceGwei,
        },
        new Date(entry.ts).getTime()
      );
    } else if (
      event === "dry_run_would_execute" ||
      event === "execute_success" ||
      event === "execute_reverted" ||
      event === "execute_error"
    ) {
      const statusMap = {
        execute_success: "success",
        execute_reverted: "reverted",
        execute_error: "error",
        dry_run_would_execute: "dry_run",
      };
      recordRun(
        {
          network: cfg.key,
          txHash: data.hash || null,
          status: statusMap[event],
          gasUsed: data.gasUsed ? Number(data.gasUsed) : null,
          elapsedMs: data.elapsedMs ?? null,
          loanSizeWeth: data.loanSizeWeth ?? 0,
          profitWeth:
            data.profitWeth ??
            (event === "dry_run_would_execute" ? data.estimatedProfitWeth : null),
        },
        new Date(entry.ts).getTime()
      );
    }
  } catch (e) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        network: cfg.key,
        event: "db_insert_failed",
        message: e.message,
      })
    );
  }
  return entry;
}

function fail(event, data, exitCode = 1) {
  log(event, data);
  if (exitCode !== null) process.exit(exitCode);
}

async function initVenues() {
  const v2Venues = getVenuesByType(cfg, "v2");
  if (v2Venues.length < 2) {
    fail("insufficient_v2_venues", {
      available: v2Venues.map((venue) => venue.id),
      hint: "Base needs the V2/V3 receiver (Phase 2); the current scanner is V2/V2 only.",
    });
  }

  [venueA, venueB] = v2Venues;

  for (const venue of [venueA, venueB]) {
    if (!venue.factory) {
      fail("venue_missing_factory", { venue: venue.id });
    }
    const code = await provider.getCode(venue.factory);
    if (code === "0x") {
      fail("factory_no_code", { venue: venue.id, address: venue.factory });
    }
  }

  const blocked = [venueA, venueB].filter((venue) => venue.adapterRequired);
  if (blocked.length > 0) {
    if (DRY_RUN) {
      log("venue_adapter_required_dry_run", {
        venues: blocked.map((venue) => venue.id),
        note: "Live execution is blocked until an adapter exists.",
      });
    } else {
      fail("venue_adapter_required", {
        venues: blocked.map((venue) => venue.id),
      });
    }
  }
}

async function checkNetwork() {
  if (!cfg.rpcUrl) {
    fail("rpc_not_configured", {
      network: cfg.key,
      env: cfg.rpcEnv || "RPC URL",
    });
  }
  const net = await provider.getNetwork();
  if (!cfg.skipChainCheck && Number(net.chainId) !== cfg.chainId) {
    fail("network_mismatch", {
      expected: cfg.chainId,
      actual: Number(net.chainId),
    });
  }
}

async function checkContract() {
  if (!cfg.contractAddress) {
    log("contract_not_configured", {
      network: cfg.key,
      env: cfg.contractEnv,
      note: DRY_RUN
        ? "Dry run will continue without sending transactions."
        : "Set the contract address before enabling live execution.",
    });
    if (!DRY_RUN) process.exit(1);
    return;
  }

  const code = await provider.getCode(cfg.contractAddress);
  if (code === "0x") {
    log("contract_no_code", { address: cfg.contractAddress });
    if (!DRY_RUN) process.exit(1);
    return;
  }

  contract = new ethers.Contract(
    cfg.contractAddress,
    CONTRACT_ABI,
    wallet || provider
  );

  try {
    const [dexA, dexB, tokenB, slippage] = await Promise.all([
      contract.dexA(),
      contract.dexB(),
      contract.tokenB(),
      contract.slippageToleranceBps(),
    ]);
    const mismatch =
      dexA.toLowerCase() !== venueA.router.toLowerCase() ||
      dexB.toLowerCase() !== venueB.router.toLowerCase() ||
      tokenB.toLowerCase() !== cfg.quote.address.toLowerCase();
    if (mismatch) {
      log("contract_config_mismatch", {
        contractDexA: dexA,
        contractDexB: dexB,
        contractTokenB: tokenB,
        scannerDexA: venueA.router,
        scannerDexB: venueB.router,
        scannerTokenB: cfg.quote.address,
        hint: "Redeploy or update the contract before live execution.",
      });
      if (!DRY_RUN) process.exit(1);
    }
    if (Number(slippage) !== strategy.slippageBufferBps) {
      log("slippage_mismatch", {
        contractBps: Number(slippage),
        scannerBps: strategy.slippageBufferBps,
      });
    }
  } catch (err) {
    log("contract_read_failed", { message: err.shortMessage || err.message });
    if (!DRY_RUN) process.exit(1);
  }
}

async function getPoolReserves(venue) {
  try {
    const factory = new ethers.Contract(venue.factory, FACTORY_ABI, provider);
    const pairAddress = await factory.getPair(
      cfg.loanToken.address,
      cfg.quote.address
    );
    if (pairAddress === ethers.ZeroAddress) {
      log("pair_not_found", {
        venue: venue.id,
        loanToken: cfg.loanToken.address,
        quoteToken: cfg.quote.address,
      });
      return null;
    }
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [reserves, token0] = await Promise.all([
      pair.getReserves(),
      pair.token0(),
    ]);
    const wethIsToken0 =
      token0.toLowerCase() === cfg.loanToken.address.toLowerCase();
    return {
      pair: pairAddress,
      reserveWeth: wethIsToken0 ? reserves[0] : reserves[1],
      reserveQuote: Number(
        ethers.formatUnits(
          wethIsToken0 ? reserves[1] : reserves[0],
          cfg.quote.decimals
        )
      ),
    };
  } catch (err) {
    log("pair_read_failed", {
      venue: venue.id,
      message: err.shortMessage || err.message,
    });
    return null;
  }
}

async function getPrice(venue, amountIn) {
  try {
    const router = new ethers.Contract(venue.router, ROUTER_ABI, provider);
    const amounts = await router.getAmountsOut(amountIn, [
      cfg.loanToken.address,
      cfg.quote.address,
    ]);
    return Number(ethers.formatUnits(amounts[1], cfg.quote.decimals));
  } catch (err) {
    log("price_read_failed", {
      venue: venue.id,
      message: err.shortMessage || err.message,
    });
    return null;
  }
}

function clampBigInt(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function estimateProfitWeth(loanSizeWeth, buyPrice, sellPrice) {
  const loanSize = Number(ethers.formatUnits(loanSizeWeth, 18));
  const swapFactor = 0.997 * (1 - strategy.slippageBufferBps / 10000);
  const quoteReceived = loanSize * sellPrice * swapFactor;
  const wethReceived = (quoteReceived / buyPrice) * swapFactor;
  return wethReceived - loanSize;
}

function extractProfitWeth(receipt) {
  const iface = new ethers.Interface(CONTRACT_ABI);
  for (const logItem of receipt.logs) {
    try {
      const parsed = iface.parseLog(logItem);
      if (parsed && parsed.name === "ArbitrageResult") {
        return Number(ethers.formatUnits(parsed.args.profit, 18));
      }
    } catch {
      // Not one of our events.
    }
  }
  return null;
}

async function executeArbitrage(
  buyOnA,
  loanSizeWeth,
  estimatedProfitWeth,
  minProfitWeth
) {
  if (isExecuting) return;
  isExecuting = true;
  const start = Date.now();
  const loanSizeLabel = ethers.formatUnits(loanSizeWeth, 18);

  log("execute_start", {
    buyOnA,
    loanSizeWeth: loanSizeLabel,
    minProfitWeth: ethers.formatUnits(minProfitWeth, 18),
  });

  if (DRY_RUN) {
    log("dry_run_would_execute", {
      buyOnA,
      loanSizeWeth: loanSizeLabel,
      estimatedProfitWeth,
      minProfitWeth: ethers.formatUnits(minProfitWeth, 18),
      hash: null,
      elapsedMs: Date.now() - start,
      note: "DRY_RUN=true — no transaction sent",
    });
    isExecuting = false;
    return;
  }

  try {
    if (!contract) throw new Error("No contract configured");
    if (!wallet) throw new Error("No PRIVATE_KEY configured");

    // Preflight: estimateGas fails if the trade would revert (including the
    // on-chain minProfit check), so we do not waste gas on a doomed tx.
    const gasEstimate = await contract.requestFlashLoan.estimateGas(
      cfg.loanToken.address,
      loanSizeWeth,
      buyOnA,
      minProfitWeth
    );
    const gasLimit = (gasEstimate * 120n) / 100n;

    const tx = await contract.requestFlashLoan(
      cfg.loanToken.address,
      loanSizeWeth,
      buyOnA,
      minProfitWeth,
      { gasLimit }
    );
    log("tx_sent", { hash: tx.hash });

    const receipt = await tx.wait();
    const elapsedMs = Date.now() - start;

    if (receipt.status === 1) {
      const profitWeth = extractProfitWeth(receipt);
      log("execute_success", {
        hash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
        elapsedMs,
        loanSizeWeth: loanSizeLabel,
        profitWeth,
      });

      try {
        const weth = new ethers.Contract(
          cfg.loanToken.address,
          ERC20_ABI,
          wallet
        );
        const balance = await weth.balanceOf(cfg.contractAddress);
        if (balance > 0n) {
          const withdrawTx = await contract.withdraw(cfg.loanToken.address);
          await withdrawTx.wait();
          log("withdraw_success", {
            hash: withdrawTx.hash,
            amountWeth: ethers.formatUnits(balance, 18),
          });
        } else {
          log("withdraw_skipped", { reason: "zero balance" });
        }
      } catch (err) {
        // Do not turn a successful trade into an error row.
        log("withdraw_error", { message: err.shortMessage || err.message });
      }
    } else {
      log("execute_reverted", {
        hash: tx.hash,
        elapsedMs,
        loanSizeWeth: loanSizeLabel,
      });
    }
  } catch (err) {
    log("execute_error", {
      message: err.shortMessage || err.message,
      elapsedMs: Date.now() - start,
      loanSizeWeth: loanSizeLabel,
    });
  } finally {
    isExecuting = false;
  }
}

async function scan() {
  try {
    const [poolA, poolB] = await Promise.all([
      getPoolReserves(venueA),
      getPoolReserves(venueB),
    ]);

    if (!poolA || !poolB) {
      log("scan_pool_fetch_failed", {});
      return;
    }

    if (
      poolA.reserveQuote < strategy.minLiquidityUsd ||
      poolB.reserveQuote < strategy.minLiquidityUsd
    ) {
      log("scan_skipped_low_liquidity", {
        aVenue: venueA.id,
        bVenue: venueB.id,
        aLiq: poolA.reserveQuote,
        bLiq: poolB.reserveQuote,
        minLiquidityUsd: strategy.minLiquidityUsd,
      });
      return;
    }

    const shallowerWethReserve =
      poolA.reserveWeth < poolB.reserveWeth
        ? poolA.reserveWeth
        : poolB.reserveWeth;
    const rawLoanSize =
      (shallowerWethReserve * BigInt(Math.round(strategy.poolPct * 10000))) /
      10000n;
    const loanSizeWeth = clampBigInt(
      rawLoanSize,
      MIN_LOAN_WETH,
      MAX_LOAN_WETH
    );

    const [priceA, priceB] = await Promise.all([
      getPrice(venueA, loanSizeWeth),
      getPrice(venueB, loanSizeWeth),
    ]);

    if (priceA === null || priceB === null) {
      log("scan_price_fetch_failed", {});
      return;
    }

    // Contract semantics: buyOnA=true means "sell the asset on venue A first",
    // which is correct when venue A pays more quote per WETH (it is expensive).
    const buyOnA = priceA > priceB;
    const sellPrice = buyOnA ? priceA : priceB;
    const buyPrice = buyOnA ? priceB : priceA;
    const spread = Math.abs(priceA - priceB);
    const spreadPct = (spread / Math.min(priceA, priceB)) * 100;
    const estimatedProfitWeth = estimateProfitWeth(
      loanSizeWeth,
      buyPrice,
      sellPrice
    );

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 0n;
    const gasCostWeth = gasPrice * GAS_ESTIMATE_UNITS;
    const thresholdRaw =
      (gasCostWeth * BigInt(Math.round(strategy.profitSafetyMultiplier * 100))) /
      100n;
    const thresholdWeth =
      thresholdRaw > MIN_PROFIT_FLOOR_WETH
        ? thresholdRaw
        : MIN_PROFIT_FLOOR_WETH;
    const thresholdWethNum = Number(ethers.formatUnits(thresholdWeth, 18));

    log("scan_checked", {
      aVenue: venueA.id,
      bVenue: venueB.id,
      priceA,
      priceB,
      spreadPct: Number(spreadPct.toFixed(4)),
      loanSizeWeth: ethers.formatUnits(loanSizeWeth, 18),
      estimatedProfitWeth: Number(estimatedProfitWeth.toFixed(6)),
      thresholdWeth: thresholdWethNum,
      gasPriceGwei: Number(ethers.formatUnits(gasPrice, "gwei")),
    });

    if (estimatedProfitWeth > thresholdWethNum) {
      log("opportunity_found", {
        buyOnA,
        estimatedProfitWeth,
        thresholdWeth: thresholdWethNum,
      });
      await executeArbitrage(
        buyOnA,
        loanSizeWeth,
        estimatedProfitWeth,
        thresholdWeth
      );
    }
  } catch (err) {
    log("scan_error", { message: err.shortMessage || err.message });
  }
}

async function start() {
  await checkNetwork();
  await initVenues();
  await checkContract();

  log("bot_started", {
    wallet: wallet?.address || "no-wallet",
    contract: contract ? cfg.contractAddress : null,
    dryRun: DRY_RUN,
    network: cfg.key,
    chainId: cfg.chainId,
    quoteToken: cfg.quoteSymbol,
    venues: [venueA.id, venueB.id],
  });

  await scan();
  setInterval(scan, 10000);
}

start().catch((err) => {
  log("fatal", { message: err.shortMessage || err.message });
  process.exit(1);
});
