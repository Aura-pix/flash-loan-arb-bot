import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../contracts/.env") });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import Database from "better-sqlite3";
const dbPath = path.resolve(__dirname, "../bot_data.sqlite");
const db = new Database(dbPath);
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
const insertScanStmt = db.prepare('INSERT INTO scans (ts, sushiPrice, uniPrice, spreadPct, loanSizeWeth, estimatedProfitWeth, thresholdWeth, gasPriceGwei) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insertRunStmt = db.prepare('INSERT INTO runs (ts, network, txHash, status, gasUsed, elapsedMs, loanSizeWeth, profitWeth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
function recordScan(d, ts = Date.now()) { return insertScanStmt.run(ts, d.sushiPrice, d.uniPrice, d.spreadPct, Number(d.loanSizeWeth), d.estimatedProfitWeth, d.thresholdWeth, d.gasPriceGwei); }
function recordRun(d, ts = Date.now()) { return insertRunStmt.run(ts, d.network, d.txHash || null, d.status, d.gasUsed ?? null, d.elapsedMs ?? null, Number(d.loanSizeWeth), d.profitWeth ?? null); }
console.log(JSON.stringify({ ts: new Date().toISOString(), network: process.env.NETWORK || "anvil-fork", event: "db_connected", dbPath }));

// ── Dry-run / Network config ────────────────────────────────────
const DRY_RUN = process.env.DRY_RUN === "true" || process.env.DRY_RUN === "1";
const NETWORK = process.env.NETWORK || "anvil-fork";

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
    SUSHISWAP_ROUTER: "0xeaBcE3E74EF41FB40024a21Cc2ee2F5dDc615791",
    UNISWAPV2_ROUTER: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
    SUSHI_FACTORY: "0x734583f62Bb6ACe3c9bA9bd5A53143CA2Ce8C55A",
    UNI_FACTORY: "0xF62c03E08ada871A0bEb309762E260a7a6a880E6",
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "0x77EC85E9b7fBcE5365a234F6FE826d7740FB517f",
  },
};

const cfg = CONFIG[NETWORK];
const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
const wallet = process.env.PRIVATE_KEY ? new ethers.Wallet(process.env.PRIVATE_KEY, provider) : null;

const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD || 100000);
const POOL_PCT = Number(process.env.POOL_PCT || 0.01);
const MIN_LOAN_WETH = ethers.parseUnits(process.env.MIN_LOAN_WETH || "0.05", 18);
const MAX_LOAN_WETH = ethers.parseUnits(process.env.MAX_LOAN_WETH || "5", 18);
const GAS_ESTIMATE_UNITS = BigInt(process.env.GAS_ESTIMATE_UNITS || 450000);
const PROFIT_SAFETY_MULTIPLIER = Number(process.env.PROFIT_SAFETY_MULTIPLIER || 2);
const MIN_PROFIT_FLOOR_WETH = ethers.parseUnits(process.env.MIN_PROFIT_FLOOR_WETH || "0.001", 18);
const SLIPPAGE_BUFFER_BPS = Number(process.env.SLIPPAGE_BUFFER_BPS || 100);

const CONTRACT_ABI = ["function requestFlashLoan(address token, uint256 amount, bool buyOnA) external", "function withdraw(address token) external"];
const FACTORY_ABI = ["function getPair(address,address) external view returns (address)"];
const PAIR_ABI = ["function getReserves() external view returns (uint112,uint112,uint32)", "function token0() external view returns (address)"];
const ROUTER_ABI = ["function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)", "function factory() external view returns (address)"];

const sushiRouter = new ethers.Contract(cfg.SUSHISWAP_ROUTER, ROUTER_ABI, provider);
const uniRouter = new ethers.Contract(cfg.UNISWAPV2_ROUTER, ROUTER_ABI, provider);
let sushiFactory, uniFactory;
async function resolveFactory(router, hardcodedFactory, label) {
  if (hardcodedFactory) {
    const code = await provider.getCode(hardcodedFactory);
    if (code === "0x") log("factory_no_code", { label, address: hardcodedFactory });
    return hardcodedFactory;
  }
  try {
    const code = await provider.getCode(await router.getAddress());
    if (code === "0x") throw new Error(`${label} router has no code`);
    return await router.factory();
  } catch (err) { log("factory_resolve_failed", { label, message: err.message }); throw err; }
}
async function initFactories() {
  const sushiFactoryAddress = await resolveFactory(sushiRouter, cfg.SUSHI_FACTORY, "sushi");
  const uniFactoryAddress = await resolveFactory(uniRouter, cfg.UNI_FACTORY, "uni");
  sushiFactory = new ethers.Contract(sushiFactoryAddress, FACTORY_ABI, provider);
  uniFactory = new ethers.Contract(uniFactoryAddress, FACTORY_ABI, provider);
}
const contract = wallet ? new ethers.Contract(cfg.CONTRACT_ADDRESS, CONTRACT_ABI, wallet) : null;
let isExecuting = false;
function log(event, data) {
  const entry = { ts: new Date().toISOString(), network: NETWORK, event, ...data };
  console.log(JSON.stringify(entry));
  try {
    if (event === "scan_checked") recordScan({ sushiPrice: data.sushiPrice, uniPrice: data.uniPrice, spreadPct: data.spreadPct, loanSizeWeth: data.loanSizeWeth, estimatedProfitWeth: data.estimatedProfitWeth, thresholdWeth: data.thresholdWeth, gasPriceGwei: data.gasPriceGwei }, new Date(entry.ts).getTime());
    else if (event === "dry_run_would_execute" || event === "execute_success" || event === "execute_reverted" || event === "execute_error") {
      const statusMap = { execute_success: "success", execute_reverted: "reverted", execute_error: "error", dry_run_would_execute: "dry_run" };
      recordRun({ network: NETWORK, txHash: data.hash || null, status: statusMap[event], gasUsed: data.gasUsed ? Number(data.gasUsed) : null, elapsedMs: data.elapsedMs || null, loanSizeWeth: data.loanSizeWeth || 0, profitWeth: data.profitWeth ?? data.estimatedProfitWeth ?? null }, new Date(entry.ts).getTime());
    }
  } catch (e) { console.log(JSON.stringify({ ts: new Date().toISOString(), network: NETWORK, event: "db_insert_failed", message: e.message })); }
  return entry;
}
async function getPoolReserves(factory) {
  try {
    const pairAddress = await factory.getPair(cfg.WETH, cfg.USDC);
    if (pairAddress === ethers.ZeroAddress) return null;
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [reserves, token0] = await Promise.all([pair.getReserves(), pair.token0()]);
    const wethIsToken0 = token0.toLowerCase() === cfg.WETH.toLowerCase();
    return { reserveWeth: wethIsToken0 ? reserves[0] : reserves[1], reserveUsdc: Number(ethers.formatUnits(wethIsToken0 ? reserves[1] : reserves[0], 6)) };
  } catch { return null; }
}
async function getPrice(router, amountIn) {
  try { const amounts = await router.getAmountsOut(amountIn, [cfg.WETH, cfg.USDC]); return Number(ethers.formatUnits(amounts[1], 6)); } catch { return null; }
}
function clampBigInt(value, min, max) { if (value < min) return min; if (value > max) return max; return value; }
function estimateProfitWeth(loanSizeWeth, buyPrice, sellPrice) {
  const loanSize = Number(ethers.formatUnits(loanSizeWeth, 18));
  const swapFactor = 0.997 * (1 - SLIPPAGE_BUFFER_BPS / 10000);
  const usdcReceived = loanSize * sellPrice * swapFactor;
  const wethReceived = (usdcReceived / buyPrice) * swapFactor;
  return wethReceived - loanSize;
}
async function executeArbitrage(buyOnSushi, loanSizeWeth, estimatedProfitWeth) {
  if (isExecuting) return; isExecuting = true; const start = Date.now();
  log("execute_start", { buyOnSushi, loanSizeWeth: ethers.formatUnits(loanSizeWeth, 18) });
  if (DRY_RUN) {
    log("dry_run_would_execute", { buyOnSushi, buyOnA: !buyOnSushi, loanSizeWeth: ethers.formatUnits(loanSizeWeth, 18), estimatedProfitWeth, hash: null, elapsedMs: Date.now() - start, note: "DRY_RUN=true — no transaction sent" });
    isExecuting = false; return;
  }
  try {
    const buyOnA = !buyOnSushi;
    const tx = await contract.requestFlashLoan(cfg.WETH, loanSizeWeth, buyOnA, { gasLimit: 500000 });
    log("tx_sent", { hash: tx.hash });
    const receipt = await tx.wait(); const elapsedMs = Date.now() - start;
    if (receipt.status === 1) {
      log("execute_success", { hash: tx.hash, gasUsed: receipt.gasUsed.toString(), elapsedMs });
      const nonce = await provider.getTransactionCount(wallet.address, "latest");
      const withdrawTx = await contract.withdraw(cfg.WETH, { nonce }); await withdrawTx.wait();
      log("withdraw_success", { hash: withdrawTx.hash });
    } else log("execute_reverted", { hash: tx.hash, elapsedMs });
  } catch (err) { log("execute_error", { message: err.message, elapsedMs: Date.now() - start }); } finally { isExecuting = false; }
}
async function scan() {
  try {
    const [sushiPool, uniPool] = await Promise.all([getPoolReserves(sushiFactory), getPoolReserves(uniFactory)]);
    if (!sushiPool || !uniPool) { log("scan_pool_fetch_failed", {}); return; }
    if (sushiPool.reserveUsdc < MIN_LIQUIDITY_USD || uniPool.reserveUsdc < MIN_LIQUIDITY_USD) { log("scan_skipped_low_liquidity", { sushiLiq: sushiPool.reserveUsdc, uniLiq: uniPool.reserveUsdc }); return; }
    const shallowerWethReserve = sushiPool.reserveWeth < uniPool.reserveWeth ? sushiPool.reserveWeth : uniPool.reserveWeth;
    const rawLoanSize = (shallowerWethReserve * BigInt(Math.round(POOL_PCT * 10000))) / 10000n;
    const loanSizeWeth = clampBigInt(rawLoanSize, MIN_LOAN_WETH, MAX_LOAN_WETH);
    const [sushiPrice, uniPrice] = await Promise.all([getPrice(sushiRouter, loanSizeWeth), getPrice(uniRouter, loanSizeWeth)]);
    if (!sushiPrice || !uniPrice) { log("scan_price_fetch_failed", {}); return; }
    const spread = Math.abs(sushiPrice - uniPrice); const spreadPct = (spread / Math.min(sushiPrice, uniPrice)) * 100;
    const buyOnSushi = sushiPrice < uniPrice; const buyPrice = buyOnSushi ? sushiPrice : uniPrice; const sellPrice = buyOnSushi ? uniPrice : sushiPrice;
    const estimatedProfitWeth = estimateProfitWeth(loanSizeWeth, buyPrice, sellPrice);
    const feeData = await provider.getFeeData(); const gasPrice = feeData.gasPrice ?? 0n;
    const gasCostWeth = gasPrice * GAS_ESTIMATE_UNITS;
    const thresholdRaw = (gasCostWeth * BigInt(Math.round(PROFIT_SAFETY_MULTIPLIER * 100))) / 100n;
    const thresholdWeth = thresholdRaw > MIN_PROFIT_FLOOR_WETH ? thresholdRaw : MIN_PROFIT_FLOOR_WETH;
    const thresholdWethNum = Number(ethers.formatUnits(thresholdWeth, 18));
    log("scan_checked", { sushiPrice, uniPrice, spreadPct: Number(spreadPct.toFixed(4)), loanSizeWeth: ethers.formatUnits(loanSizeWeth, 18), estimatedProfitWeth: Number(estimatedProfitWeth.toFixed(6)), thresholdWeth: thresholdWethNum, gasPriceGwei: Number(ethers.formatUnits(gasPrice, "gwei")) });
    if (estimatedProfitWeth > thresholdWethNum) { log("opportunity_found", { buyOnSushi, estimatedProfitWeth, thresholdWethNum }); await executeArbitrage(buyOnSushi, loanSizeWeth, estimatedProfitWeth); }
  } catch (err) { log("scan_error", { message: err.message }); }
}
async function start() {
  log("bot_started", { wallet: wallet?.address || "no-wallet", contract: cfg.CONTRACT_ADDRESS, dryRun: DRY_RUN });
  try { await initFactories(); } catch (e) { log("init_failed", { message: e.message }); process.exit(1); }
  await scan(); setInterval(scan, 10000);
}
start();
