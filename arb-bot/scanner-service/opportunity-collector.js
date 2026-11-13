import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import {
  getNetworkConfig,
  getStrategyConfig,
} from "../config/networks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

for (const envFile of [
  path.resolve(__dirname, "../.env.local"),
  path.resolve(__dirname, "../../contracts/.env"),
  path.resolve(process.cwd(), ".env"),
]) {
  dotenv.config({ path: envFile, quiet: true });
}
dotenv.config({ quiet: true });

const NETWORK = process.env.NETWORK || "base";
const cfg = getNetworkConfig(NETWORK);
const strategy = getStrategyConfig();

const INTERVAL_MS = Number(process.env.COLLECT_INTERVAL_MS || 60000);
const CONCURRENCY = Math.max(1, Number(process.env.COLLECT_CONCURRENCY || 2));
const DELAY_MS = Math.max(0, Number(process.env.COLLECT_DELAY_MS || 50));
const SAFETY_MARGIN_BPS = Number(process.env.SAFETY_MARGIN_BPS || 20);
const L1_FEE_WETH = Number(process.env.L1_FEE_WETH || 0.00005);
const GAS_UNITS = BigInt(strategy.gasEstimateUnits);

const SIZES = (process.env.COLLECT_SIZES_WETH || "0.1,0.25,0.5,1,2,5")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
if (SIZES.length === 0) SIZES.push(0.25);

const DEFAULT_VENUES = {
  base: "uniswap-v2,uniswap-v3,pancake-v3",
  arbitrum: "sushi-v2,camelot-v2,uniswap-v3",
  sepolia: "sushi-v2,uniswap-v2",
  "anvil-fork": "sushi-v2,uniswap-v2",
};
const selectedVenueIds = (process.env.COLLECT_VENUES || DEFAULT_VENUES[cfg.key] || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const dbPath = process.env.OPPORTUNITY_DB_PATH
  ? path.resolve(process.env.OPPORTUNITY_DB_PATH)
  : path.resolve(__dirname, "../opportunity_data.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    network TEXT NOT NULL,
    pair TEXT NOT NULL,
    sizeWeth REAL NOT NULL,
    sellVenue TEXT NOT NULL,
    sellFee INTEGER,
    buyVenue TEXT NOT NULL,
    buyFee INTEGER,
    wethToQuote REAL NOT NULL,
    quoteToWeth REAL NOT NULL,
    grossProfitWeth REAL NOT NULL,
    gasCostWeth REAL NOT NULL,
    l1FeeWeth REAL NOT NULL,
    safetyWeth REAL NOT NULL,
    netProfitWeth REAL NOT NULL,
    netProfitUsd REAL NOT NULL,
    wethPriceUsd REAL NOT NULL,
    gasPriceGwei REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_opportunities_ts ON opportunities(ts);
  CREATE INDEX IF NOT EXISTS idx_opportunities_net ON opportunities(netProfitWeth);
`);
const insertOpportunity = db.prepare(`
  INSERT INTO opportunities (
    ts, network, pair, sizeWeth,
    sellVenue, sellFee, buyVenue, buyFee,
    wethToQuote, quoteToWeth,
    grossProfitWeth, gasCostWeth, l1FeeWeth, safetyWeth,
    netProfitWeth, netProfitUsd, wethPriceUsd, gasPriceGwei
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const provider = cfg.rpcUrl ? new ethers.JsonRpcProvider(cfg.rpcUrl) : null;

const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
];
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

const routes = [];
for (const venue of cfg.venues || []) {
  if (!selectedVenueIds.includes(venue.id)) continue;
  if (venue.type === "v2") {
    routes.push({
      id: `${venue.id}:v2`,
      venueId: venue.id,
      label: venue.label,
      type: "v2",
      fee: null,
      router: venue.router,
    });
  } else if (venue.type === "v3") {
    for (const fee of venue.feeTiers || []) {
      routes.push({
        id: `${venue.id}:${fee}`,
        venueId: venue.id,
        label: venue.label,
        type: "v3",
        fee,
        router: venue.router,
        quoter: venue.quoter,
      });
    }
  }
}

const inactiveRoutes = new Set();
const lastErrorLog = new Map();
let cycleIndex = 0;
let running = false;
let timer = null;

function log(event, data) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      network: cfg.key,
      event,
      ...data,
    })
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRevert(err) {
  const text = `${err?.shortMessage || ""} ${err?.message || ""}`.toLowerCase();
  return (
    text.includes("revert") ||
    text.includes("call_exception") ||
    err?.code === "CALL_EXCEPTION"
  );
}

function noteRouteError(route, phase, err) {
  const now = Date.now();
  const last = lastErrorLog.get(route.id) || 0;
  if (now - last > 60000) {
    lastErrorLog.set(route.id, now);
    log("quote_error", {
      route: route.id,
      phase,
      message: err?.shortMessage || err?.message || String(err),
    });
  }
  if (isRevert(err)) {
    inactiveRoutes.add(route.id);
    log("route_inactive", { route: route.id, phase });
  }
}

async function quoteRoute(route, amountIn, tokenIn, tokenOut) {
  if (route.type === "v2") {
    const router = new ethers.Contract(route.router, ROUTER_ABI, provider);
    const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
    return amounts[1];
  }

  const quoter = new ethers.Contract(route.quoter, QUOTER_ABI, provider);
  const result = await quoter.quoteExactInputSingle.staticCall({
    tokenIn,
    tokenOut,
    amountIn,
    fee: route.fee,
    sqrtPriceLimitX96: BigInt(0),
  });
  return result[0];
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

function quoteValue(amount, decimals) {
  return Number(ethers.formatUnits(amount, decimals));
}

async function collectCycle() {
  if (running) return;
  running = true;
  const startedAt = Date.now();

  try {
    if (!provider) {
      log("collector_error", { message: "RPC URL not configured" });
      return;
    }

    const size = SIZES[cycleIndex % SIZES.length];
    cycleIndex += 1;
    const amountIn = ethers.parseUnits(String(size), 18);
    const gasPrice = (await provider.getFeeData()).gasPrice ?? BigInt(0);
    const gasCostWeth = Number(ethers.formatEther(gasPrice * GAS_UNITS));
    const safetyWeth = size * (SAFETY_MARGIN_BPS / 10000);
    const activeRoutes = routes.filter((route) => !inactiveRoutes.has(route.id));

    if (activeRoutes.length < 2) {
      log("collector_error", {
        message: "Fewer than two active routes",
        routes: activeRoutes.map((route) => route.id),
      });
      return;
    }

    const sellResults = await mapLimit(activeRoutes, CONCURRENCY, async (route) => {
      try {
        const out = await quoteRoute(
          route,
          amountIn,
          cfg.loanToken.address,
          cfg.quote.address
        );
        return {
          route,
          out,
          quoteAmount: quoteValue(out, cfg.quote.decimals),
        };
      } catch (err) {
        noteRouteError(route, "sell", err);
        return null;
      }
    });
    const sells = sellResults.filter(Boolean);

    if (sells.length === 0) {
      log("collector_error", { message: "No sell quotes", sizeWeth: size });
      return;
    }

    let best = null;

    for (const sell of sells) {
      const buyRoutes = activeRoutes.filter(
        (route) => route.id !== sell.route.id
      );
      const buyResults = await mapLimit(
        buyRoutes,
        CONCURRENCY,
        async (buyRoute) => {
          try {
            const wethOut = await quoteRoute(
              buyRoute,
              sell.out,
              cfg.quote.address,
              cfg.loanToken.address
            );
            const wethOutValue = quoteValue(wethOut, cfg.loanToken.decimals);
            const grossProfitWeth = wethOutValue - size;
            const netProfitWeth =
              grossProfitWeth - gasCostWeth - L1_FEE_WETH - safetyWeth;
            const wethPriceUsd = sell.quoteAmount / size;
            return {
              sell: sell.route,
              buy: buyRoute,
              wethToQuote: sell.quoteAmount,
              quoteToWeth: wethOutValue,
              grossProfitWeth,
              netProfitWeth,
              netProfitUsd: netProfitWeth * wethPriceUsd,
              wethPriceUsd,
            };
          } catch (err) {
            noteRouteError(buyRoute, "buy", err);
            return null;
          }
        }
      );

      for (const row of buyResults) {
        if (!row) continue;
        if (!best || row.netProfitWeth > best.netProfitWeth) best = row;
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    if (!best) {
      log("collector_error", { message: "No buy quotes", sizeWeth: size });
      return;
    }

    const ts = Date.now();
    const gasPriceGwei = Number(ethers.formatUnits(gasPrice, "gwei"));
    insertOpportunity.run(
      ts,
      cfg.key,
      `${cfg.quoteSymbol}/WETH`,
      size,
      best.sell.venueId,
      best.sell.fee,
      best.buy.venueId,
      best.buy.fee,
      best.wethToQuote,
      best.quoteToWeth,
      best.grossProfitWeth,
      gasCostWeth,
      L1_FEE_WETH,
      safetyWeth,
      best.netProfitWeth,
      best.netProfitUsd,
      best.wethPriceUsd,
      gasPriceGwei
    );

    const netBps = (best.netProfitWeth / size) * 10000;
    log("opportunity_sample", {
      sizeWeth: size,
      sell: best.sell.id,
      buy: best.buy.id,
      grossProfitWeth: Number(best.grossProfitWeth.toFixed(8)),
      gasCostWeth: Number(gasCostWeth.toFixed(8)),
      l1FeeWeth: L1_FEE_WETH,
      netProfitWeth: Number(best.netProfitWeth.toFixed(8)),
      netProfitUsd: Number(best.netProfitUsd.toFixed(4)),
      netProfitBps: Number(netBps.toFixed(2)),
      wethPriceUsd: Number(best.wethPriceUsd.toFixed(2)),
    });

    if (best.netProfitWeth > 0) {
      log("opportunity_found", {
        sizeWeth: size,
        sell: best.sell.id,
        buy: best.buy.id,
        netProfitWeth: Number(best.netProfitWeth.toFixed(8)),
        netProfitUsd: Number(best.netProfitUsd.toFixed(4)),
      });
    }

    log("collect_cycle", {
      sizeWeth: size,
      activeRoutes: activeRoutes.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    log("collector_error", {
      message: err?.shortMessage || err?.message || String(err),
    });
  } finally {
    running = false;
  }
}

async function start() {
  if (!cfg.rpcUrl) {
    log("collector_started", { error: `Missing ${cfg.rpcEnv || "RPC URL"}` });
    process.exit(1);
  }
  if (!provider) {
    log("collector_started", { error: "Provider unavailable" });
    process.exit(1);
  }

  const network = await provider.getNetwork();
  if (!cfg.skipChainCheck && Number(network.chainId) !== cfg.chainId) {
    log("collector_started", {
      error: "Chain ID mismatch",
      expected: cfg.chainId,
      actual: Number(network.chainId),
    });
    process.exit(1);
  }

  log("collector_started", {
    dbPath,
    chainId: cfg.chainId,
    quoteToken: cfg.quoteSymbol,
    routes: routes.map((route) => route.id),
    sizes: SIZES,
    intervalMs: INTERVAL_MS,
    concurrency: CONCURRENCY,
    l1FeeWeth: L1_FEE_WETH,
    safetyMarginBps: SAFETY_MARGIN_BPS,
    note: "Read-only: this process never sends transactions.",
  });

  if (routes.length < 2) {
    log("collector_error", {
      message: "Fewer than two configured routes",
      selected: selectedVenueIds,
    });
    process.exit(1);
  }

  await collectCycle();
  timer = setInterval(collectCycle, INTERVAL_MS);
}

function shutdown(signal) {
  if (timer) clearInterval(timer);
  try {
    db.close();
  } catch {
    // Ignore close errors.
  }
  log("collector_stopped", { signal });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((err) => {
  log("collector_error", {
    message: err?.shortMessage || err?.message || String(err),
  });
  process.exit(1);
});
