/**
 * Single source of truth for networks, tokens, and venues.
 *
 * This file is dependency-free so it can be imported by:
 *   - the Next.js server code (lib/*.ts, app/api/*)
 *   - the standalone scanner (scanner-service/scanner.js)
 *
 * Environment variables are read inside getNetworkConfig()/getExecutionConfig(),
 * not at module load, because the scanner loads dotenv after static imports.
 */

export const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

export const NETWORKS = {
  "anvil-fork": {
    label: "Anvil Fork",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    skipChainCheck: true,
    contractEnv: "CONTRACT_ADDRESS",
    contractAddress: "0x1C33Db5FC563ac9732C5352c37B73d95b7015E6f",
    defaultQuote: "USDC",
    tokens: {
      WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    },
    venues: [
      {
        id: "sushi-v2",
        label: "SushiSwap V2",
        type: "v2",
        router: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
        factory: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac",
      },
      {
        id: "uniswap-v2",
        label: "Uniswap V2",
        type: "v2",
        router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
      },
    ],
  },

  sepolia: {
    label: "Sepolia Testnet",
    chainId: 11155111,
    rpcEnv: "SEPOLIA_RPC_URL",
    contractEnv: "CONTRACT_ADDRESS",
    contractAddress: "0x893144cA871B2f21399f56B385542273aBaae04D",
    defaultQuote: "USDC",
    tokens: {
      WETH: { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18 },
      USDC: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
    },
    venues: [
      {
        id: "sushi-v2",
        label: "SushiSwap V2",
        type: "v2",
        router: "0xeaBcE3E74EF41FB40024a21Cc2ee2F5dDc615791",
        factory: "0x734583f62Bb6ACe3c9bA9bd5A53143CA2Ce8C55A",
      },
      {
        id: "uniswap-v2",
        label: "Uniswap V2",
        type: "v2",
        router: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
        factory: "0xF62c03E08ada871A0bEb309762E260a7a6a880E6",
      },
    ],
  },

  arbitrum: {
    label: "Arbitrum One",
    chainId: 42161,
    rpcEnv: "ARBITRUM_RPC_URL",
    contractEnv: "ARBITRUM_CONTRACT_ADDRESS",
    contractAddress: "",
    // The only viable V2/V2 route on Arbitrum uses bridged USDC (USDC.e).
    defaultQuote: "USDC_E",
    tokens: {
      WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
      USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      USDC_E: { address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6 },
      USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    },
    venues: [
      {
        id: "sushi-v2",
        label: "SushiSwap V2",
        type: "v2",
        router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
        factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
      },
      {
        id: "camelot-v2",
        label: "Camelot V2",
        type: "v2",
        router: "0xc873fEcbd354f5A56E00E710B90EF4201db2448d",
        factory: "0x6EcCab422D763aC031210895C81787E87B43A652",
        // The Camelot router does not expose the standard UniswapV2 swap ABI.
        // Do not enable live execution against this venue until an adapter lands.
        adapterRequired: true,
      },
      {
        id: "uniswap-v2",
        label: "Uniswap V2",
        type: "v2",
        router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
        factory: "0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9",
      },
      {
        id: "uniswap-v3",
        label: "Uniswap V3",
        type: "v3",
        router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        feeTiers: [100, 500, 3000, 10000],
      },
    ],
  },

  base: {
    label: "Base",
    chainId: 8453,
    rpcEnv: "BASE_RPC_URL",
    contractEnv: "BASE_CONTRACT_ADDRESS",
    contractAddress: "",
    defaultQuote: "USDC",
    tokens: {
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      cbBTC: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
    },
    venues: [
      {
        id: "uniswap-v2",
        label: "Uniswap V2",
        type: "v2",
        router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
        factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
        pair: "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
      },
      {
        id: "uniswap-v3",
        label: "Uniswap V3",
        type: "v3",
        router: "0x2626664c2603336E57B271c5C0b26F421741e481",
        factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
        quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
        feeTiers: [100, 500, 3000, 10000],
      },
      {
        id: "pancake-v3",
        label: "PancakeSwap V3",
        type: "v3",
        router: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
        factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
        quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
        feeTiers: [100, 500, 2500, 10000],
      },
      {
        id: "sushi-v2",
        label: "SushiSwap V2",
        type: "v2",
        router: "0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891",
        factory: "0x71524B4f93c58fcbF659783284E38825f0622859",
      },
      {
        id: "pancake-v2",
        label: "PancakeSwap V2",
        type: "v2",
        router: "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb",
        factory: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E",
      },
      {
        id: "baseswap-v2",
        label: "BaseSwap V2",
        type: "v2",
        router: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",
        factory: "0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB",
      },
    ],
  },
};

export function listNetworks() {
  return Object.keys(NETWORKS);
}

export function getNetworkConfig(name) {
  const key = name || process.env.NETWORK || "anvil-fork";
  const net = NETWORKS[key];
  if (!net) {
    throw new Error(
      `Unknown NETWORK "${key}". Supported: ${listNetworks().join(", ")}`
    );
  }

  const rpcUrl = net.rpcUrl || (net.rpcEnv ? process.env[net.rpcEnv] || "" : "");
  const contractAddress =
    process.env[net.contractEnv] || net.contractAddress || "";
  const quoteSymbol = process.env.QUOTE_TOKEN || net.defaultQuote || "USDC";
  const quote = net.tokens[quoteSymbol];

  if (!quote) {
    throw new Error(
      `Unknown QUOTE_TOKEN "${quoteSymbol}" for ${key}. Supported: ${Object.keys(net.tokens).join(", ")}`
    );
  }

  return {
    ...net,
    key,
    rpcUrl,
    contractAddress,
    quoteSymbol,
    quote,
    loanToken: net.tokens.WETH,
    balancerVault: BALANCER_VAULT,
  };
}

export function getVenue(net, id) {
  return (net.venues || []).find((venue) => venue.id === id) || null;
}

export function getVenuesByType(net, type) {
  return (net.venues || []).filter((venue) => venue.type === type);
}

export function getToken(net, symbol) {
  const token = net.tokens[symbol];
  if (!token) {
    throw new Error(
      `Unknown token "${symbol}" for ${net.key}. Supported: ${Object.keys(net.tokens).join(", ")}`
    );
  }
  return token;
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function getStrategyConfig() {
  return {
    minLiquidityUsd: numberEnv("MIN_LIQUIDITY_USD", 100000),
    poolPct: numberEnv("POOL_PCT", 0.01),
    minLoanWeth: process.env.MIN_LOAN_WETH || "0.05",
    maxLoanWeth: process.env.MAX_LOAN_WETH || "5",
    gasEstimateUnits: process.env.GAS_ESTIMATE_UNITS || "450000",
    profitSafetyMultiplier: numberEnv("PROFIT_SAFETY_MULTIPLIER", 2),
    minProfitFloorWeth: process.env.MIN_PROFIT_FLOOR_WETH || "0.001",
    slippageBufferBps: numberEnv("SLIPPAGE_BUFFER_BPS", 100),
    expectedSlippageBps: numberEnv("EXPECTED_SLIPPAGE_BPS", 20),
    minNetProfitWeth: process.env.MIN_NET_PROFIT_WETH || "0.0005",
  };
}

export function isDryRun() {
  return process.env.DRY_RUN === "true" || process.env.DRY_RUN === "1";
}

export function isLiveExecutionEnabled() {
  return process.env.ENABLE_LIVE_EXECUTION === "true";
}

export function isExecutorEnabled() {
  return process.env.EXECUTOR_ENABLED === "true";
}
