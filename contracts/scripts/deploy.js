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
  SUSHISWAP_ROUTER: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
};

async function main() {
  if (!process.env.SEPOLIA_RPC_URL)
    throw new Error("Missing SEPOLIA_RPC_URL in .env");

  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("Deploying from:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("Sepolia ETH balance:", ethers.formatEther(balance));
  if (balance === 0n)
    throw new Error("Wallet has 0 Sepolia ETH — use a faucet first.");

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet,
  );
  console.log("\nDeploying FlashLoanReceiver...");
  const contract = await factory.deploy(
    SEPOLIA.SUSHISWAP_ROUTER,
    SEPOLIA.SUSHISWAP_ROUTER,
    SEPOLIA.USDC,
  );
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("Deployed at:", address);

  const [owner, dexA, dexB, tokenB] = await Promise.all([
    contract.owner(),
    contract.dexA(),
    contract.dexB(),
    contract.tokenB(),
  ]);

  console.log("\n--- Sanity check ---");
  console.log(
    "owner:  ",
    owner,
    owner === wallet.address ? "✅" : "❌ MISMATCH",
  );
  console.log(
    "dexA:   ",
    dexA,
    dexA === SEPOLIA.SUSHISWAP_ROUTER ? "✅" : "❌ MISMATCH",
  );
  console.log(
    "dexB:   ",
    dexB,
    dexB === SEPOLIA.SUSHISWAP_ROUTER ? "✅" : "❌ MISMATCH",
  );
  console.log(
    "tokenB: ",
    tokenB,
    tokenB === SEPOLIA.USDC ? "✅" : "❌ MISMATCH",
  );

  console.log(
    "\nView on Sepolia Etherscan: https://sepolia.etherscan.io/address/" +
      address,
  );
}

main().catch(console.error);
