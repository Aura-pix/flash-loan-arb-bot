import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

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
    CONTRACT_ADDRESS: "0xD2ec315B6f013f3AaaB32da7EdFdb6c3f28a040E",
  },
  sepolia: {
    rpcUrl: process.env.SEPOLIA_RPC_URL || "",
    WETH: "", // TODO: fill in when redeploying from PC
    USDC: "", // TODO
    SUSHISWAP_ROUTER: "", // TODO — confirm SushiSwap has a live Sepolia deployment
    UNISWAPV2_ROUTER: "", // TODO
    SUSHI_FACTORY: "", // TODO
    UNI_FACTORY: "", // TODO
    CONTRACT_ADDRESS: "", // TODO — fill after redeploy
  },
};

const cfg = CONFIG[NETWORK];
if (NETWORK === "sepolia" && !cfg.CONTRACT_ADDRESS) {
  console.warn("⚠️  Sepolia config is unfilled — this will fail until addresses are set.");
}

const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// ── Strategy config — all env-tunable, none hardcoded into the contract ──
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD || 100000);

// Loan sizing: % of the shallower pool's WETH reserve, clamped to a
// sane floor/ceiling so we never size a loan off a freak-thin pool
// or overexpose capital on an unusually deep one.
const POOL_PCT = Number(process.env.POOL_PCT || 0.01); // 1% default
const MIN_LOAN_WETH = ethers.parseUnits(process.env.MIN_LOAN_WETH || "0.05", 18);
const MAX_LOAN_WETH = ethers.parseUnits(process.env.MAX_LOAN_WETH || "5", 18);

// Profit threshold: gas-aware floor, not a flat guess.
const GAS_ESTIMATE_UNITS = BigInt(process.env.GAS_ESTIMATE_UNITS || 450000);
const PROFIT_SAFETY_MULTIPLIER = Number(process.env.PROFIT_SAFETY_MULTIPLIER || 2);
const MIN_PROFIT_FLOOR_WETH = ethers.parseUnits(process.env.MIN_PROFIT_FLOOR_WETH || "0.001", 18);

// The off-chain estimate below assumed only the nominal 0.3%/swap DEX fee —
// but the contract's own slippageToleranceBps (1% default) means real
// on-chain execution can legally land up to that much worse per swap.
// Keep this in sync with the contract's slippageToleranceBps.
const SLIPPAGE_BUFFER_BPS = Number(process.env.SLIPPAGE_BUFFER_BPS || 100);

const CONTRACT_ABI = [
  "function requestFlashLoan(address token, uint256 amount, bool buyOnA) external",
  "function withdraw(address token) external",
];
const FACTORY_ABI = ["function getPair(address,address) external view returns (address)"];
const PAIR_ABI = [
  "function getReserves() external view returns (uint112,uint112,uint32)",
  "function token0() external view returns (address)",
];
const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
];

const sushiFactory = new ethers.Contract(cfg.SUSHI_FACTORY, FACTORY_ABI, provider);
const uniFactory = new ethers.Contract(cfg.UNI_FACTORY, FACTORY_ABI, provider);
const sushiRouter = new ethers.Contract(cfg.SUSHISWAP_ROUTER, ROUTER_ABI, provider);
const uniRouter = new ethers.Contract(cfg.UNISWAPV2_ROUTER, ROUTER_ABI, provider);
const contract = new ethers.Contract(cfg.CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

let isExecuting = false;

// ── Structured logging ──────────────────────────────────────────
function log(event, data) {
  const entry = { ts: new Date().toISOString(), network: NETWORK, event, ...data };
  console.log(JSON.stringify(entry));
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
    const [reserves, token0] = await Promise.all([pair.getReserves(), pair.token0()]);

    const wethIsToken0 = token0.toLowerCase() === cfg.WETH.toLowerCase();
    const reserveWeth = wethIsToken0 ? reserves[0] : reserves[1];
    const reserveUsdc = wethIsToken0 ? reserves[1] : reserves[0];

    return { reserveWeth, reserveUsdc: Number(ethers.formatUnits(reserveUsdc, 6)) };
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

async function executeArbitrage(buyOnSushi, loanSizeWeth) {
  if (isExecuting) return;
  isExecuting = true;
  const start = Date.now();

  log("execute_start", { buyOnSushi, loanSizeWeth: ethers.formatUnits(loanSizeWeth, 18) });
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
      const nonce = await provider.getTransactionCount(wallet.address, "latest");
      const withdrawTx = await contract.withdraw(cfg.WETH, { nonce });
      await withdrawTx.wait();
      log("withdraw_success", { hash: withdrawTx.hash });
    } else {
      log("execute_reverted", { hash: tx.hash, elapsedMs });
    }
  } catch (err) {
    log("execute_error", { message: err.message, elapsedMs: Date.now() - start });
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

    if (sushiPool.reserveUsdc < MIN_LIQUIDITY_USD || uniPool.reserveUsdc < MIN_LIQUIDITY_USD) {
      log("scan_skipped_low_liquidity", {
        sushiLiq: sushiPool.reserveUsdc,
        uniLiq: uniPool.reserveUsdc,
      });
      return;
    }

    // Size the loan off the shallower pool's WETH reserve, clamped to
    // a sane floor/ceiling.
    const shallowerWethReserve =
      sushiPool.reserveWeth < uniPool.reserveWeth ? sushiPool.reserveWeth : uniPool.reserveWeth;
    const rawLoanSize = (shallowerWethReserve * BigInt(Math.round(POOL_PCT * 10000))) / 10000n;
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
    const estimatedProfitWeth = estimateProfitWeth(loanSizeWeth, buyPrice, sellPrice);

    // Gas-aware profit threshold — recomputed every scan since gas price moves.
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 0n;
    const gasCostWeth = gasPrice * GAS_ESTIMATE_UNITS;
    const thresholdRaw = (gasCostWeth * BigInt(Math.round(PROFIT_SAFETY_MULTIPLIER * 100))) / 100n;
    const thresholdWeth = thresholdRaw > MIN_PROFIT_FLOOR_WETH ? thresholdRaw : MIN_PROFIT_FLOOR_WETH;
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
      log("opportunity_found", { buyOnSushi, estimatedProfitWeth, thresholdWethNum });
      await executeArbitrage(buyOnSushi, loanSizeWeth);
    }
  } catch (err) {
    log("scan_error", { message: err.message });
  }
}

log("bot_started", { wallet: wallet.address, contract: cfg.CONTRACT_ADDRESS });
scan();
setInterval(scan, 10000);