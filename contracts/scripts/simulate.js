import { ethers } from "ethers";
import fs from "fs";

// Path is relative to contracts/scripts/ — matches your confirmed artifact location.
const artifact = JSON.parse(
  fs.readFileSync(
    "./artifacts/contracts/FlashLoanReceiver.sol/FlashLoanReceiver.json",
    "utf8"
  )
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
const FACTORY_ABI = ["function getPair(address,address) external view returns (address)"];
const PAIR_ABI = ["function getReserves() external view returns (uint112,uint112,uint32)"];

async function simulate() {
  const signer = await provider.getSigner(0);
  const address = await signer.getAddress();
  console.log("Simulating with account:", address);
  console.log("ETH Balance:", ethers.formatEther(await provider.getBalance(address)));

  const sushiFactory = new ethers.Contract(
    "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac",
    FACTORY_ABI,
    provider
  );
  const sushiPair = await sushiFactory.getPair(WETH, USDC);
  const sushiReserves = await new ethers.Contract(sushiPair, PAIR_ABI, provider).getReserves();
  console.log("SushiSwap reserves:", sushiReserves[0].toString(), sushiReserves[1].toString());

  const uniFactory = new ethers.Contract(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    FACTORY_ABI,
    provider
  );
  const uniPair = await uniFactory.getPair(WETH, USDC);
  const uniReserves = await new ethers.Contract(uniPair, PAIR_ABI, provider).getReserves();
  console.log("UniswapV2 reserves:", uniReserves[0].toString(), uniReserves[1].toString());

  console.log("\nDeploying flash loan contract...");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(SUSHISWAP, UNISWAPV2, USDC);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  console.log("Contract deployed at:", contractAddress);

  const weth = new ethers.Contract(WETH, WETH_ABI, signer);
  await weth.deposit({ value: ethers.parseEther("0.1") });
  await weth.transfer(contractAddress, ethers.parseEther("0.1"));
  console.log("Funded contract with 0.1 WETH");

  const balanceBefore = await weth.balanceOf(contractAddress);
  console.log("Contract WETH before:", ethers.formatEther(balanceBefore));

  console.log("\nExecuting flash loan...");
  try {
    const tx = await contract.requestFlashLoan(WETH, ethers.parseUnits("1", 18), false, {
      gasLimit: 3000000,
    });
    console.log("Transaction sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED");
    console.log("Gas used:", receipt.gasUsed.toString());

    const balanceAfter = await weth.balanceOf(contractAddress);
    console.log("Contract WETH after:", ethers.formatEther(balanceAfter));
    console.log("Profit:", ethers.formatEther(balanceAfter - balanceBefore), "WETH");
  } catch (err) {
    console.error("Flash loan failed:", err.message);
    if (err.data) console.error("Revert reason:", err.data);
  }
}

simulate().catch(console.error);