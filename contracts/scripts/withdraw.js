import { ethers } from "ethers";

// Sweeps any leftover WETH out of a deployed contract instance —
// resets state between test runs so results aren't subsidized by
// leftover funding from a previous simulate.js run.
const CONTRACT_ADDRESS = "0x07829000c467CF70d6cBEBecC7FE49b94cbc9c25";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const signer = await provider.getSigner(0);

const ABI = ["function withdraw(address token) external"];
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

const tx = await contract.withdraw(WETH);
await tx.wait();
console.log("Swept leftover WETH from", CONTRACT_ADDRESS);