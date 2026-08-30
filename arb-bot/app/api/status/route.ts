import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import db from '../../../lib/db';

const NETWORK = process.env.NETWORK || 'anvil-fork';
const CONFIG: Record<string, { rpcUrl: string; chainId: number; WETH: string; USDC: string; label: string }> = {
  'anvil-fork': { rpcUrl: 'http://127.0.0.1:8545', chainId: 31337, WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', label: 'Anvil Fork' },
  sepolia: { rpcUrl: process.env.SEPOLIA_RPC_URL || '', chainId: 11155111, WETH: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', label: 'Sepolia Testnet' },
  arbitrum: { rpcUrl: process.env.ARBITRUM_RPC_URL || '', chainId: 42161, WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', USDC: '0xFF970A64a04b2c50Ca2B3a27AffecA216E196Ec', label: 'Arbitrum One' },
};

export async function GET() {
  const cfg = CONFIG[NETWORK] || CONFIG['anvil-fork'];
  const walletAddress = process.env.PRIVATE_KEY ? (() => { try { return new ethers.Wallet(process.env.PRIVATE_KEY as string).address; } catch { return null; } })() : null;

  let balances: { eth: string | null; weth: string | null; usdc: string | null } = { eth: null, weth: null, usdc: null };
  let rpcOk = false;

  if (cfg.rpcUrl && walletAddress) {
    try {
      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const ethBal = await provider.getBalance(walletAddress);
      balances.eth = ethers.formatEther(ethBal);
      rpcOk = true;
      // WETH/USDC ERC20 balances — best effort, ignore if call fails (e.g. no code on fork)
      try {
        const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
        const weth = new ethers.Contract(cfg.WETH, erc20Abi, provider);
        const wethBal: bigint = await weth.balanceOf(walletAddress);
        balances.weth = ethers.formatUnits(wethBal, 18);
      } catch {}
      try {
        const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
        const usdc = new ethers.Contract(cfg.USDC, erc20Abi, provider);
        const usdcBal: bigint = await usdc.balanceOf(walletAddress);
        balances.usdc = ethers.formatUnits(usdcBal, 6);
      } catch {}
    } catch {
      rpcOk = false;
    }
  }

  let lastScan: any = null;
  let lastRun: any = null;
  try {
    lastScan = db.prepare('SELECT * FROM scans ORDER BY ts DESC LIMIT 1').get() as any;
    lastRun = db.prepare('SELECT * FROM runs ORDER BY ts DESC LIMIT 1').get() as any;
  } catch {}

  const isOpportunity = lastScan ? lastScan.estimatedProfitWeth > lastScan.thresholdWeth : false;
  const dryRun = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';

  return NextResponse.json({
    network: NETWORK,
    chainId: cfg.chainId,
    label: cfg.label,
    walletAddress: walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : '0x1234...ABCD',
    walletAddressFull: walletAddress,
    balances,
    rpcOk,
    dryRun,
    lastScan: lastScan ? { ts: lastScan.ts, spreadPct: lastScan.spreadPct, estimatedProfitWeth: lastScan.estimatedProfitWeth, thresholdWeth: lastScan.thresholdWeth, isOpportunity } : null,
    lastRun: lastRun ? { ts: lastRun.ts, status: lastRun.status, txHash: lastRun.txHash } : null,
    scanning: true,
  });
}
