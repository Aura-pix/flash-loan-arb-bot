import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import db from '../../../lib/db';
import {
  getNetworkConfig,
  isDryRun,
  isExecutorEnabled,
} from '../../../config/networks.js';

type ScanRow = {
  ts: number;
  spreadPct: number;
  estimatedProfitWeth: number;
  thresholdWeth: number;
};

type RunRow = {
  ts: number;
  status: string;
  txHash: string | null;
  profitWeth: number | null;
};

type VenueSummary = {
  id: string;
  label: string;
  type: string;
};

export async function GET() {
  const cfg = getNetworkConfig();
  const walletAddress = process.env.PRIVATE_KEY
    ? (() => {
        try {
          return new ethers.Wallet(process.env.PRIVATE_KEY as string).address;
        } catch {
          return null;
        }
      })()
    : process.env.ACCOUNT_ADDRESS || null;

  const balances: {
    eth: string | null;
    weth: string | null;
    usdc: string | null;
  } = { eth: null, weth: null, usdc: null };
  let rpcOk = false;

  if (cfg.rpcUrl) {
    try {
      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      await provider.getBlockNumber();
      rpcOk = true;

      if (walletAddress) {
        const ethBal = await provider.getBalance(walletAddress);
        balances.eth = ethers.formatEther(ethBal);

        try {
          const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
          const weth = new ethers.Contract(
            cfg.loanToken.address,
            erc20Abi,
            provider
          );
          const wethBal: bigint = await weth.balanceOf(walletAddress);
          balances.weth = ethers.formatUnits(wethBal, cfg.loanToken.decimals);
        } catch {
          // Best effort; a fork may not have the token deployed.
        }

        try {
          const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
          const quote = new ethers.Contract(
            cfg.quote.address,
            erc20Abi,
            provider
          );
          const quoteBal: bigint = await quote.balanceOf(walletAddress);
          balances.usdc = ethers.formatUnits(quoteBal, cfg.quote.decimals);
        } catch {
          // Best effort.
        }
      }
    } catch {
      rpcOk = false;
    }
  }

  let lastScan: ScanRow | null = null;
  let lastRun: RunRow | null = null;
  try {
    lastScan =
      (db
        .prepare(
          'SELECT * FROM scans WHERE network = ? ORDER BY ts DESC LIMIT 1'
        )
        .get(cfg.key) as ScanRow | undefined) ?? null;
    lastRun =
      (db
        .prepare(
          'SELECT * FROM runs WHERE network = ? ORDER BY ts DESC LIMIT 1'
        )
        .get(cfg.key) as RunRow | undefined) ?? null;
  } catch {
    // Tables may not exist yet on a fresh install.
  }

  const isOpportunity = lastScan
    ? lastScan.estimatedProfitWeth > lastScan.thresholdWeth
    : false;

  return NextResponse.json({
    network: cfg.key,
    chainId: cfg.chainId,
    label: cfg.label,
    quoteSymbol: cfg.quoteSymbol,
    walletAddress: walletAddress
      ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
      : '0x1234...ABCD',
    walletAddressFull: walletAddress,
    balances,
    rpcOk,
    dryRun: isDryRun(),
    executorEnabled: isExecutorEnabled(),
    venues: ((cfg.venues || []) as VenueSummary[]).map(
      (venue: VenueSummary) => ({
        id: venue.id,
        label: venue.label,
        type: venue.type,
      })
    ),
    lastScan: lastScan
      ? {
          ts: lastScan.ts,
          spreadPct: lastScan.spreadPct,
          estimatedProfitWeth: lastScan.estimatedProfitWeth,
          thresholdWeth: lastScan.thresholdWeth,
          isOpportunity,
        }
      : null,
    lastRun: lastRun
      ? {
          ts: lastRun.ts,
          status: lastRun.status,
          txHash: lastRun.txHash,
          profitWeth: lastRun.profitWeth,
        }
      : null,
    scanning: true,
  });
}
