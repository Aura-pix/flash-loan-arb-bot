import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";
import {
  getNetworkConfig,
  getVenue,
  getVenuesByType,
} from "../../arb-bot/config/networks.js";

dotenv.config({ quiet: true });

// Deploys the V2/V2 receiver. The V2/V3 receiver (Base) will supersede this
// contract in the next phase; this script still refuses to deploy to mainnet
// without an explicit confirmation.
//
// Usage:
//   NETWORK=base BASE_RPC_URL=... PRIVATE_KEY=... CONFIRM_DEPLOY=1 node scripts/deploy.js
//   NETWORK=arbitrum ARBITRUM_RPC_URL=... PRIVATE_KEY=... CONFIRM_DEPLOY=1 node scripts/deploy.js
//   NETWORK=sepolia SEPOLIA_RPC_URL=... PRIVATE_KEY=... node scripts/deploy.js

const ARTIFACT_PATH =
  "./artifacts/contracts/FlashLoanReceiver.sol/FlashLoanReceiver.json";

const EXPLORERS = {
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
  sepolia: "https://sepolia.etherscan.io/address/",
  "anvil-fork": "",
};

function resolveVenue(net, value) {
  if (!value) return null;
  const venue = getVenue(net, value);
  return venue ? venue.router : value;
}

async function main() {
  const networkName = process.env.NETWORK;
  if (!networkName) {
    throw new Error(
      "NETWORK is required (base | arbitrum | sepolia | anvil-fork)"
    );
  }

  const net = getNetworkConfig(networkName);
  if (!net.rpcUrl) {
    throw new Error(
      `Missing RPC URL for ${net.label}. Set ${net.rpcEnv || "the RPC URL"}.`
    );
  }
  if (!process.env.PRIVATE_KEY) {
    throw new Error("Missing PRIVATE_KEY in contracts/.env or the environment.");
  }
  if (
    (networkName === "base" || networkName === "arbitrum") &&
    process.env.CONFIRM_DEPLOY !== "1"
  ) {
    throw new Error(
      `Refusing to deploy to ${net.label} without CONFIRM_DEPLOY=1.`
    );
  }

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
  const provider = new ethers.JsonRpcProvider(net.rpcUrl);
  const network = await provider.getNetwork();
  if (!net.skipChainCheck && Number(network.chainId) !== net.chainId) {
    throw new Error(
      `RPC chain ID ${Number(network.chainId)} does not match ${net.label} (${net.chainId}).`
    );
  }

  const v2Venues = getVenuesByType(net, "v2");
  const dexA = resolveVenue(net, process.env.DEX_A) || v2Venues[0]?.router;
  const dexB = resolveVenue(net, process.env.DEX_B) || v2Venues[1]?.router;
  if (!dexA || !dexB) {
    throw new Error(
      `Two V2 venues are required for this contract. Set DEX_A and DEX_B. Available V2 venues: ${v2Venues.map((v) => `${v.id}=${v.router}`).join(", ")}`
    );
  }
  if (dexA.toLowerCase() === dexB.toLowerCase()) {
    throw new Error("DEX_A and DEX_B must be different routers.");
  }

  const tokenB = net.quote.address;
  const weth = net.loanToken.address;
  for (const [label, address] of [
    ["WETH", weth],
    ["quote token", tokenB],
    ["dexA", dexA],
    ["dexB", dexB],
    ["Balancer Vault", net.balancerVault],
  ]) {
    const code = await provider.getCode(address);
    if (code === "0x") {
      throw new Error(`${label} has no bytecode at ${address} on ${net.label}.`);
    }
  }

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deploying to ${net.label} (chain ${net.chainId})`);
  console.log(`From: ${wallet.address}`);
  console.log(`Native balance: ${ethers.formatEther(balance)}`);
  if (balance === 0n) {
    throw new Error(`Wallet has 0 native currency on ${net.label}. Fund it first.`);
  }

  console.log(`\nWETH:      ${weth}`);
  console.log(`Token B:   ${tokenB} (${net.quoteSymbol})`);
  console.log(`dexA:      ${dexA}`);
  console.log(`dexB:      ${dexB}`);
  console.log(`Vault:     ${net.balancerVault}`);

  const factoryAbi = ["function getPair(address,address) view returns (address)"];
  const pairAbi = [
    "function getReserves() view returns (uint112,uint112,uint32)",
    "function token0() view returns (address)",
  ];
  const minLiquidityUsd = Number(process.env.MIN_LIQUIDITY_USD || 100000);

  console.log("\n--- Pair preflight ---");
  for (const [label, venue] of [
    ["dexA", getVenue(net, process.env.DEX_A) || v2Venues.find((v) => v.router.toLowerCase() === dexA.toLowerCase())],
    ["dexB", getVenue(net, process.env.DEX_B) || v2Venues.find((v) => v.router.toLowerCase() === dexB.toLowerCase())],
  ]) {
    if (!venue || !venue.factory) {
      console.log(`${label}: no factory configured; skipping pair preflight`);
      continue;
    }
    try {
      const factory = new ethers.Contract(venue.factory, factoryAbi, provider);
      const pairAddress = await factory.getPair(weth, tokenB);
      if (pairAddress === ethers.ZeroAddress) {
        throw new Error(`no ${net.quoteSymbol}/WETH pair on ${venue.id}`);
      }
      const pair = new ethers.Contract(pairAddress, pairAbi, provider);
      const [reserves, token0] = await Promise.all([
        pair.getReserves(),
        pair.token0(),
      ]);
      const wethIsToken0 = token0.toLowerCase() === weth.toLowerCase();
      const quoteReserve = Number(
        ethers.formatUnits(
          wethIsToken0 ? reserves[1] : reserves[0],
          net.quote.decimals
        )
      );
      const status = quoteReserve >= minLiquidityUsd ? "OK" : "LOW";
      console.log(
        `${label} (${venue.id}): pair=${pairAddress} quoteReserve=${quoteReserve.toFixed(2)} ${net.quoteSymbol} [${status}]`
      );
      if (quoteReserve < minLiquidityUsd) {
        console.warn(
          `  WARNING: ${venue.id} is below MIN_LIQUIDITY_USD=${minLiquidityUsd}; the scanner will skip it.`
        );
      }
      if (venue.adapterRequired) {
        console.warn(
          `  WARNING: ${venue.id} needs a swap adapter; live execution is blocked.`
        );
      }
    } catch (err) {
      console.warn(`${label}: pair preflight failed: ${err.message}`);
    }
  }

  console.log("\nDeploying FlashLoanReceiver...");
  const contractFactory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet
  );
  const contract = await contractFactory.deploy(dexA, dexB, tokenB);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  const [owner, deployedDexA, deployedDexB, deployedTokenB] =
    await Promise.all([
      contract.owner(),
      contract.dexA(),
      contract.dexB(),
      contract.tokenB(),
    ]);

  console.log(`\nDeployed at: ${address}`);
  console.log("\n--- Sanity check ---");
  console.log(`owner:  ${owner} ${owner === wallet.address ? "OK" : "MISMATCH"}`);
  console.log(
    `dexA:   ${deployedDexA} ${deployedDexA.toLowerCase() === dexA.toLowerCase() ? "OK" : "MISMATCH"}`
  );
  console.log(
    `dexB:   ${deployedDexB} ${deployedDexB.toLowerCase() === dexB.toLowerCase() ? "OK" : "MISMATCH"}`
  );
  console.log(
    `tokenB: ${deployedTokenB} ${deployedTokenB.toLowerCase() === tokenB.toLowerCase() ? "OK" : "MISMATCH"}`
  );

  if (net.contractEnv) {
    console.log(`\nSet in the bot environment:\n  ${net.contractEnv}=${address}`);
  }
  const explorer = EXPLORERS[networkName];
  if (explorer) console.log(`\nView: ${explorer}${address}`);
}

main().catch((err) => {
  console.error(`\nDeploy failed: ${err.message}`);
  process.exit(1);
});
