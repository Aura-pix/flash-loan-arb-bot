import { ethers } from "ethers";
import fs from "fs";

// One-off verification: deploys fresh, checks CURRENT real prices, picks
// the CORRECT direction per the fixed logic, and executes regardless of
// profit threshold — purely to confirm the direction fix produces a
// sensible (not guaranteed-loss) result on real fork data.

const artifact = JSON.parse(
  fs.readFileSync("./artifacts/contracts/FlashLoanReceiver.sol/FlashLoanReceiver.json", "utf8")
);

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SUSHISWAP = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
const UNISWAPV2 = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

const WETH_ABI = [
  "function deposit() external payable",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address) external view returns (uint256)",
];
const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
];

async function main() {
  const signer = await provider.getSigner(0);

  const loanAmount = ethers.parseUnits("0.629", 18); // matches scanner's recent sizing

  const sushiRouter = new ethers.Contract(SUSHISWAP, ROUTER_ABI, provider);
  const uniRouter = new ethers.Contract(UNISWAPV2, ROUTER_ABI, provider);

  const [sushiOut, uniOut] = await Promise.all([
    sushiRouter.getAmountsOut(loanAmount, [WETH, USDC]),
    uniRouter.getAmountsOut(loanAmount, [WETH, USDC]),
  ]);
  const sushiPrice = Number(ethers.formatUnits(sushiOut[1], 6));
  const uniPrice = Number(ethers.formatUnits(uniOut[1], 6));
  console.log("Sushi price:", sushiPrice, "| Uni price:", uniPrice);

  // Contract's buyOnA=true means "sell on dexA (Sushi) first" — correct
  // exactly when Sushi is the EXPENSIVE side.
  const buyOnA = sushiPrice > uniPrice;
  console.log("Sushi is", buyOnA ? "expensive (sell there first)" : "cheap (buy there)");
  console.log("Setting buyOnA =", buyOnA);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(SUSHISWAP, UNISWAPV2, USDC);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  console.log("Deployed at:", contractAddress);

  const weth = new ethers.Contract(WETH, WETH_ABI, signer);
  const balanceBefore = await weth.balanceOf(contractAddress);

  console.log("\nExecuting with corrected direction...");
  try {
    const tx = await contract.requestFlashLoan(WETH, loanAmount, buyOnA, { gasLimit: 500000 });
    const receipt = await tx.wait();
    console.log("Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED");
    console.log("Gas used:", receipt.gasUsed.toString());

    const balanceAfter = await weth.balanceOf(contractAddress);
    console.log("Profit:", ethers.formatEther(balanceAfter - balanceBefore), "WETH");
  } catch (err) {
    console.error("Reverted:", err.message);
  }
}

main().catch(console.error);