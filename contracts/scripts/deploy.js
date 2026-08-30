import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

// Deploys FlashLoanReceiver to Sepolia and confirms it deployed correctly.
// Uniswap V2 has NO official Sepolia deployment (confirmed via Uniswap's own
// docs), so this uses SushiSwap's router for BOTH dexA and dexB — this only
// validates deployment/plumbing correctness, not real two-DEX arbitrage.
// That validation already happened on the forked-mainnet tests.

const artifact = JSON.parse(
  fs.readFileSync(
    "./artifacts/contracts/FlashLoanReceiver.sol/FlashLoanReceiver.json",
    "utf8",
  ),
);

const SEPOLIA = {
  WETH: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  // Fixed Sepolia routers — 0xd9e1...B9F is mainnet-only (no code on Sepolia)
  SUSHISWAP_ROUTER: "0xeaBcE3E74EF41FB40024a21Cc2ee2F5dDc615791",
  UNISWAP_ROUTER: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
};

const ARBITRUM = {
  WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  SUSHISWAP_ROUTER: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
  UNISWAP_ROUTER: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
};

async function main() {
  const NETWORK = process.env.NETWORK || "sepolia";
  const netCfg = NETWORK === "arbitrum" ? ARBITRUM : SEPOLIA;
  const rpcUrl = NETWORK === "arbitrum" ? process.env.ARBITRUM_RPC_URL : process.env.SEPOLIA_RPC_URL;
  const explorer = NETWORK === "arbitrum" ? "https://arbiscan.io/address/" : "https://sepolia.etherscan.io/address/";
  if (!rpcUrl) throw new Error(`Missing ${NETWORK === "arbitrum" ? "ARBITRUM_RPC_URL" : "SEPOLIA_RPC_URL"} in .env`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Deploying to ${NETWORK} from:`, wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log(`${NETWORK} ETH balance:`, ethers.formatEther(balance));
  if (balance === 0n) throw new Error(`Wallet has 0 ${NETWORK} ETH — fund first.`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log("\nDeploying FlashLoanReceiver...");
  console.log(` dexA (Sushi):  ${netCfg.SUSHISWAP_ROUTER}`);
  console.log(` dexB (UniV2):  ${netCfg.UNISWAP_ROUTER}`);
  const contract = await factory.deploy(netCfg.SUSHISWAP_ROUTER, netCfg.UNISWAP_ROUTER, netCfg.USDC);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("Deployed at:", address);

  const [owner, dexA, dexB, tokenB] = await Promise.all([contract.owner(), contract.dexA(), contract.dexB(), contract.tokenB()]);

  console.log("\n--- Sanity check ---");
  console.log("owner:  ", owner, owner === wallet.address ? "✅" : "❌ MISMATCH");
  console.log("dexA:   ", dexA, dexA === netCfg.SUSHISWAP_ROUTER ? "✅" : "❌ MISMATCH");
  console.log("dexB:   ", dexB, dexB === netCfg.UNISWAP_ROUTER ? "✅" : "❌ MISMATCH");
  console.log("tokenB: ", tokenB, tokenB === netCfg.USDC ? "✅" : "❌ MISMATCH");

  console.log(`\nView on explorer: ${explorer}${address}`);
}

main().catch(console.error);
