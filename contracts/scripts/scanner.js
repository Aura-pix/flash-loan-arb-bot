import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
dotenv.config();

// ── Dry-run mode ────────────────────────────────────────────────
// When DRY_RUN=true scanner computes everything it normally would —
// spread, sizing, profit — and logs what it would have executed
// without sending the transaction. Useful on Sepolia where liquidity
// is thin or on mainnet-fork for validation without gas.
const DRY_RUN = process.env.DRY_RUN === "true" || process.env.DRY_RUN === "1";

// ── Network config ──────────────────────────────────────────────
// Set NETWORK=sepolia in .env once deployed from PC. Anvil-fork values
// stay as the default so local testing keeps working in the meantime.
const NETWORK = process.env.NETWORK || "anvil-fork"; // "anvil-fork" | "sepolia"

const CONFIG = {
  "anvil-fork": {
    rpcUrl: "http://127.0.0.1:8545",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    SUSHISWAP_ROUTER: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
    UNISWAPV2_ROUTER: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    SUSHI_FACTORY: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac",
    UNI_FACTORY: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    CONTRACT_ADDRESS: "0x1C33Db5FC563ac9732C5352c37B73d95b7015E6f",
  },
  sepolia: {
    rpcUrl: process.env.SEPOLIA_RPC_URL || "",
    WETH: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    // Correct Sepolia deployments — previous 0xd9e1...B9F is mainnet-only (no code on Sepolia -> factory() BAD_DATA)
    // Uniswap V2 Sepolia official: factory 0xF62c03E08ada871A0bEb309762E260a7a6a880E6 router 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3
    // Sushi Sepolia: router 0xeaBcE3E74EF41FB40024a21Cc2ee2F5dDc615791 factory 0x734583f62Bb6ACe3c9bA9bd5A53143CA2Ce8C55A
    SUSHISWAP_ROUTER: "0xeaBcE3E74EF41FB40024a21Cc2ee2F5dDc615791",
    UNISWAPV2_ROUTER: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
    SUSHI_FACTORY: "0x734583f62Bb6ACe3c9bA9bd5A53143CA2Ce8C55A",
    UNI_FACTORY: "0xF62c03E08ada871A0bEb309762E260a7a6a880E6",
    CONTRACT_ADDRESS: "0x893144cA871B2f21399f56B385542273aBaae04D",
  },
  arbitrum: {
    rpcUrl: process.env.ARBITRUM_RPC_URL || "",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    USDC: "0xFF970A64a04b2c50Ca2B3a27AffecA216E196Ec", // USDC.e on Arbitrum (V2 pools, 168k liquidity)
    // Arbitrum One: Sushi 0x1b02..., UniV2 0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24 (factory 0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9)
    SUSHISWAP_ROUTER: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    UNISWAPV2_ROUTER: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
    SUSHI_FACTORY: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
    UNI_FACTORY: "0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9",
    CONTRACT_ADDRESS: process.env.ARBITRUM_CONTRACT_ADDRESS || "",
  },
};

const cfg = CONFIG[NETWORK];
if (NETWORK === "sepolia" && !cfg.CONTRACT_ADDRESS) {
  console.warn(
    "⚠️  Sepolia config is unfilled — this will fail until addresses are set.",
  );
}

const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// ── Strategy config — all env-tunable, none hardcoded into the contract ──
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD || 100000);

// Loan sizing: % of the shallower pool's WETH reserve, clamped to a
// sane floor/ceiling so we never size a loan off a freak-thin pool
// or overexpose capital on an unusually deep one.
const POOL_PCT = Number(process.env.POOL_PCT || 0.01); // 1% default
const MIN_LOAN_WETH = ethers.parseUnits(
  process.env.MIN_LOAN_WETH || "0.05",
  18,
);
const MAX_LOAN_WETH = ethers.parseUnits(process.env.MAX_LOAN_WETH || "5", 18);

// Profit threshold: gas-aware floor, not a flat guess.
const GAS_ESTIMATE_UNITS = BigInt(process.env.GAS_ESTIMATE_UNITS || 450000);
const PROFIT_SAFETY_MULTIPLIER = Number(
  process.env.PROFIT_SAFETY_MULTIPLIER || 2,
);
const MIN_PROFIT_FLOOR_WETH = ethers.parseUnits(
  process.env.MIN_PROFIT_FLOOR_WETH || "0.001",
  18,
);

// The off-chain estimate below assumed only the nominal 0.3%/swap DEX fee —
// but the contract's own slippageToleranceBps (1% default) means real
// on-chain execution can legally land up to that much worse per swap.
// Keep this in sync with the contract's slippageToleranceBps.
const SLIPPAGE_BUFFER_BPS = Number(process.env.SLIPPAGE_BUFFER_BPS || 100);

const CONTRACT_ABI = [
  "function requestFlashLoan(address token, uint256 amount, bool buyOnA) external",
  "function withdraw(address token) external",
];
const FACTORY_ABI = [
  "function getPair(address,address) external view returns (address)",
];
const PAIR_ABI = [
  "function getReserves() external view returns (uint112,uint112,uint32)",
  "function token0() external view returns (address)",
];
const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
  "function factory() external view returns (address)",
];

const sushiRouter = new ethers.Contract(
  cfg.SUSHISWAP_ROUTER,
  ROUTER_ABI,
  provider,
);
const uniRouter = new ethers.Contract(
  cfg.UNISWAPV2_ROUTER,
  ROUTER_ABI,
  provider,
);

// Helper to resolve factory safely — checks on-chain code first and
// falls back to CONFIG value so missing-router doesn't crash at import time
// with `could not decode result data (BAD_DATA)`.
async function resolveFactory(router, hardcodedFactory, label) {
  if (hardcodedFactory) {
    // Verify hardcoded factory actually has code
    const code = await provider.getCode(hardcodedFactory);
    if (code === "0x") {
      log("factory_no_code", { label, address: hardcodedFactory });
    }
    return hardcodedFactory;
  }
  try {
    const code = await provider.getCode(await router.getAddress());
    if (code === "0x") {
      log("router_no_code", { label, address: await router.getAddress() });
      throw new Error(`${label} router has no code at ${await router.getAddress()} on ${NETWORK}`);
    }
    return await router.factory();
  } catch (err) {
    log("factory_resolve_failed", { label, message: err.message });
    throw err;
  }
}

let sushiFactory;
let uniFactory;

async function initFactories() {
  const sushiFactoryAddress = await resolveFactory(sushiRouter, cfg.SUSHI_FACTORY, "sushi");
  const uniFactoryAddress = await resolveFactory(uniRouter, cfg.UNI_FACTORY, "uni");
  sushiFactory = new ethers.Contract(sushiFactoryAddress, FACTORY_ABI, provider);
  uniFactory = new ethers.Contract(uniFactoryAddress, FACTORY_ABI, provider);

  // Sanity check contract's dexA/dexB match scanner config — otherwise
  // requestFlashLoan will revert on-chain (contract tries to swap on dead router)
  try {
    const abi2 = ["function dexA() view returns(address)", "function dexB() view returns(address)"];
    const c = new ethers.Contract(cfg.CONTRACT_ADDRESS, abi2, provider);
    const [dexA, dexB] = await Promise.all([c.dexA(), c.dexB()]);
    if (dexA.toLowerCase() !== cfg.SUSHISWAP_ROUTER.toLowerCase() || dexB.toLowerCase() !== cfg.UNISWAPV2_ROUTER.toLowerCase()) {
      log("contract_dex_mismatch", {
        contractDexA: dexA,
        contractDexB: dexB,
        scannerSushiRouter: cfg.SUSHISWAP_ROUTER,
        scannerUniRouter: cfg.UNISWAPV2_ROUTER,
        hint: "Redeploy contract with correct Sepolia routers — current on-chain dexA/B will revert",
      });
    }
  } catch {}
}

const contract = new ethers.Contract(
  cfg.CONTRACT_ADDRESS,
  CONTRACT_ABI,
  wallet,
);

let isExecuting = false;

// ── SQLite ingestion (optional, graceful fallback) ──────────────
// Tries to open arb-bot/bot_data.sqlite if better-sqlite3 is available.
// Path resolves relative to this file so it works from both
// contracts/scripts/ and arb-bot/scanner-service/.
let db = null;
let insertScanStmt = null;
let insertRunStmt = null;
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    process.env.BOT_DB_PATH,
    path.resolve(__dirname, "../../arb-bot/bot_data.sqlite"),
    path.resolve(__dirname, "../bot_data.sqlite"),
    path.resolve(process.cwd(), "bot_data.sqlite"),
    path.resolve(process.cwd(), "arb-bot/bot_data.sqlite"),
  ].filter(Boolean);
  const dbPath = candidates.find((p) => {
    try { return fs.existsSync(path.dirname(p)); } catch { return false; }
  }) || candidates[0];
  if (dbPath) {
    const Database = (await import("better-sqlite3")).default;
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
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
    `);
    insertScanStmt = db.prepare(
      "INSERT INTO scans (ts, sushiPrice, uniPrice, spreadPct, loanSizeWeth, estimatedProfitWeth, thresholdWeth, gasPriceGwei) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    insertRunStmt = db.prepare(
      "INSERT INTO runs (ts, network, txHash, status, gasUsed, elapsedMs, loanSizeWeth, profitWeth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    console.log(JSON.stringify({ ts: new Date().toISOString(), network: NETWORK, event: "db_connected", dbPath }));
  }
} catch (e) {
  // better-sqlite3 not installed in contracts workspace — that's fine.
  // arb-bot/scanner-service/ will handle ingestion instead.
  console.log(JSON.stringify({ ts: new Date().toISOString(), network: NETWORK, event: "db_not_available", message: e.message }));
}

// ── Structured logging ──────────────────────────────────────────
function log(event, data) {
  const entry = {
    ts: new Date().toISOString(),
    network: NETWORK,
    event,
    ...data,
  };
  console.log(JSON.stringify(entry));
  // Mirror to SQLite when available
  try {
    if (db) {
      if (event === "scan_checked" && insertScanStmt) {
        insertScanStmt.run(
          Date.now(),
          data.sushiPrice,
          data.uniPrice,
          data.spreadPct,
          Number(data.loanSizeWeth),
          data.estimatedProfitWeth,
          data.thresholdWeth,
          data.gasPriceGwei
        );
      } else if ((event === "execute_success" || event === "execute_reverted" || event === "execute_error" || event === "dry_run_would_execute") && insertRunStmt) {
        const statusMap = { execute_success: "success", execute_reverted: "reverted", execute_error: "error", dry_run_would_execute: "dry_run" };
        insertRunStmt.run(
          Date.now(),
          NETWORK,
          data.hash || data.txHash || null,
          statusMap[event] || event,
          data.gasUsed ? Number(data.gasUsed) : null,
          data.elapsedMs || null,
          data.loanSizeWeth ? Number(data.loanSizeWeth) : 0,
          data.profitWeth ?? data.estimatedProfitWeth ?? null
        );
      }
    }
  } catch (e) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), network: NETWORK, event: "db_insert_failed", message: e.message }));
  }
  return entry;
}

// Reads both reserves and returns them correctly assigned regardless of
// token sort order — do NOT assume reserves[0] is always USDC, that only
// held on mainnet by address-sort coincidence.
async function getPoolReserves(factory) {
  try {
    const pairAddress = await factory.getPair(cfg.WETH, cfg.USDC);
    if (pairAddress === ethers.ZeroAddress) return null;

    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [reserves, token0] = await Promise.all([
      pair.getReserves(),
      pair.token0(),
    ]);

    const wethIsToken0 = token0.toLowerCase() === cfg.WETH.toLowerCase();
    const reserveWeth = wethIsToken0 ? reserves[0] : reserves[1];
    const reserveUsdc = wethIsToken0 ? reserves[1] : reserves[0];

    return {
      reserveWeth,
      reserveUsdc: Number(ethers.formatUnits(reserveUsdc, 6)),
    };
  } catch {
    return null;
  }
}

async function getPrice(router, amountIn) {
  try {
    const amounts = await router.getAmountsOut(amountIn, [cfg.WETH, cfg.USDC]);
    return Number(ethers.formatUnits(amounts[1], 6));
  } catch {
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
  // Worst-case per-swap factor: nominal 0.3% DEX fee AND the full slippage
  // tolerance the contract would legally accept before reverting. This is
  // deliberately pessimistic — real execution is usually better than this,
  // but the estimate should only clear the bar when it's safe even if not.
  const swapFactor = 0.997 * (1 - SLIPPAGE_BUFFER_BPS / 10000);
  const usdcReceived = loanSize * sellPrice * swapFactor;
  const wethReceived = (usdcReceived / buyPrice) * swapFactor;
  return wethReceived - loanSize;
}

async function executeArbitrage(buyOnSushi, loanSizeWeth, estimatedProfitWeth) {
  if (isExecuting) return;
  isExecuting = true;
  const start = Date.now();

  log("execute_start", {
    buyOnSushi,
    loanSizeWeth: ethers.formatUnits(loanSizeWeth, 18),
  });

  // Dry-run: compute everything, log intent, skip on-chain tx
  if (DRY_RUN) {
    const elapsedMs = Date.now() - start;
    log("dry_run_would_execute", {
      buyOnSushi,
      buyOnA: !buyOnSushi,
      loanSizeWeth: ethers.formatUnits(loanSizeWeth, 18),
      estimatedProfitWeth,
      hash: null,
      elapsedMs,
      note: "DRY_RUN=true — no transaction sent",
    });
    isExecuting = false;
    return;
  }

  try {
    // The contract's `buyOnA` means "sell first on dexA (Sushi) because it's
    // the EXPENSIVE side" — the opposite of `buyOnSushi`, which flags Sushi
    // as the CHEAP side to buy on. Passing buyOnSushi directly here was
    // inverted and guaranteed every trade sold low and bought high.
    const buyOnA = !buyOnSushi;
    const tx = await contract.requestFlashLoan(cfg.WETH, loanSizeWeth, buyOnA, {
      gasLimit: 500000,
    });
    log("tx_sent", { hash: tx.hash });

    const receipt = await tx.wait();
    const elapsedMs = Date.now() - start;

    if (receipt.status === 1) {
      log("execute_success", {
        hash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
        elapsedMs,
      });

      // Fetch nonce fresh from "latest" (post-confirmation) state rather than
      // relying on the provider's cached pending count, which can be stale
      // when txs fire in quick succession on a fast-mining local node.
      const nonce = await provider.getTransactionCount(
        wallet.address,
        "latest",
      );
      const withdrawTx = await contract.withdraw(cfg.WETH, { nonce });
      await withdrawTx.wait();
      log("withdraw_success", { hash: withdrawTx.hash });
    } else {
      log("execute_reverted", { hash: tx.hash, elapsedMs });
    }
  } catch (err) {
    log("execute_error", {
      message: err.message,
      elapsedMs: Date.now() - start,
    });
  } finally {
    isExecuting = false;
  }
}

async function scan() {
  try {
    const [sushiPool, uniPool] = await Promise.all([
      getPoolReserves(sushiFactory),
      getPoolReserves(uniFactory),
    ]);

    if (!sushiPool || !uniPool) {
      log("scan_pool_fetch_failed", {});
      return;
    }

    if (
      sushiPool.reserveUsdc < MIN_LIQUIDITY_USD ||
      uniPool.reserveUsdc < MIN_LIQUIDITY_USD
    ) {
      log("scan_skipped_low_liquidity", {
        sushiLiq: sushiPool.reserveUsdc,
        uniLiq: uniPool.reserveUsdc,
      });
      return;
    }

    // Size the loan off the shallower pool's WETH reserve, clamped to
    // a sane floor/ceiling.
    const shallowerWethReserve =
      sushiPool.reserveWeth < uniPool.reserveWeth
        ? sushiPool.reserveWeth
        : uniPool.reserveWeth;
    const rawLoanSize =
      (shallowerWethReserve * BigInt(Math.round(POOL_PCT * 10000))) / 10000n;
    const loanSizeWeth = clampBigInt(rawLoanSize, MIN_LOAN_WETH, MAX_LOAN_WETH);

    const [sushiPrice, uniPrice] = await Promise.all([
      getPrice(sushiRouter, loanSizeWeth),
      getPrice(uniRouter, loanSizeWeth),
    ]);

    if (!sushiPrice || !uniPrice) {
      log("scan_price_fetch_failed", {});
      return;
    }

    const spread = Math.abs(sushiPrice - uniPrice);
    const spreadPct = (spread / Math.min(sushiPrice, uniPrice)) * 100;
    const buyOnSushi = sushiPrice < uniPrice;
    const buyPrice = buyOnSushi ? sushiPrice : uniPrice;
    const sellPrice = buyOnSushi ? uniPrice : sushiPrice;
    const estimatedProfitWeth = estimateProfitWeth(
      loanSizeWeth,
      buyPrice,
      sellPrice,
    );

    // Gas-aware profit threshold — recomputed every scan since gas price moves.
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 0n;
    const gasCostWeth = gasPrice * GAS_ESTIMATE_UNITS;
    const thresholdRaw =
      (gasCostWeth * BigInt(Math.round(PROFIT_SAFETY_MULTIPLIER * 100))) / 100n;
    const thresholdWeth =
      thresholdRaw > MIN_PROFIT_FLOOR_WETH
        ? thresholdRaw
        : MIN_PROFIT_FLOOR_WETH;
    const thresholdWethNum = Number(ethers.formatUnits(thresholdWeth, 18));

    log("scan_checked", {
      sushiPrice,
      uniPrice,
      spreadPct: Number(spreadPct.toFixed(4)),
      loanSizeWeth: ethers.formatUnits(loanSizeWeth, 18),
      estimatedProfitWeth: Number(estimatedProfitWeth.toFixed(6)),
      thresholdWeth: thresholdWethNum,
      gasPriceGwei: Number(ethers.formatUnits(gasPrice, "gwei")),
    });

    if (estimatedProfitWeth > thresholdWethNum) {
      log("opportunity_found", {
        buyOnSushi,
        estimatedProfitWeth,
        thresholdWethNum,
      });
      await executeArbitrage(buyOnSushi, loanSizeWeth, estimatedProfitWeth);
    }
  } catch (err) {
    log("scan_error", { message: err.message });
  }
}

async function start() {
  log("bot_started", { wallet: wallet.address, contract: cfg.CONTRACT_ADDRESS });
  try {
    await initFactories();
  } catch (e) {
    log("init_failed", { message: e.message });
    process.exit(1);
  }
  await scan();
  setInterval(scan, 10000);
}
start();
