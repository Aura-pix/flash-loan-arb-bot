"use client";
import { useEffect, useState } from "react";

type StatusResp = {
  network: string;
  chainId: number;
  label: string;
  walletAddress: string;
  walletAddressFull: string | null;
  balances: { eth: string | null; weth: string | null; usdc: string | null };
  rpcOk: boolean;
  dryRun: boolean;
  lastScan: { ts: number; spreadPct: number; estimatedProfitWeth: number; thresholdWeth: number; isOpportunity: boolean } | null;
  scanning: boolean;
};

export default function DashboardPage() {
  const [status, setStatus] = useState<StatusResp | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) setStatus(await res.json());
      } catch {}
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, []);

  const networkLabel = status?.label || "Sepolia Testnet";
  const chainId = status?.chainId || 11155111;
  const walletShort = status?.walletAddress || "0x1234...ABCD";
  const ethBal = status?.balances.eth ? Number(status.balances.eth).toFixed(4) : "0.5420";
  const wethBal = status?.balances.weth ? Number(status.balances.weth).toFixed(4) : "1.2500";
  const usdcBal = status?.balances.usdc ? Number(status.balances.usdc).toFixed(2) : "2,450.00";
  const isLive = status?.rpcOk ?? false;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">Dashboard</h2>
        {status?.dryRun && (
          <span className="text-xs font-mono bg-accent/10 text-accent border border-accent/20 px-2.5 py-1 rounded-sm uppercase tracking-wider font-bold">
            Dry-run mode
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Bot Status Card */}
        <div className="bg-panel border border-line p-5 rounded-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-dim uppercase tracking-wider">Bot Status</span>
            <div className={`flex items-center gap-2 px-2.5 py-1 rounded-sm text-xs font-bold uppercase tracking-wider border ${status?.lastScan?.isOpportunity ? "bg-good/10 text-good border-good/20" : "bg-good/10 text-good border-good/20"}`}>
              <div className="w-1.5 h-1.5 rounded-full bg-good animate-pulse"></div>
              {status?.lastScan?.isOpportunity ? "Opportunity" : "Running"}
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-mono text-ink tracking-tight">ACTIVE</div>
            <div className="text-xs text-ink-dim mt-2">
              Watching WETH/USDC (Sushi vs UniV2)
              {status?.lastScan && (
                <span className="ml-2 font-mono">· spread {status.lastScan.spreadPct.toFixed(4)}%</span>
              )}
            </div>
            {status?.lastScan && (
              <div className="text-xs font-mono mt-1 text-ink-dim">
                Est. profit {status.lastScan.estimatedProfitWeth.toFixed(4)} · threshold {status.lastScan.thresholdWeth.toFixed(4)} WETH
              </div>
            )}
          </div>
        </div>

        {/* Network Selector Card */}
        <div className="bg-panel border border-line p-5 rounded-sm flex flex-col gap-4">
          <span className="text-sm font-medium text-ink-dim uppercase tracking-wider">Network</span>
          <div className="flex-1 flex flex-col justify-center mt-2">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-sm bg-line flex items-center justify-center text-sm font-bold text-ink border border-line shadow-inner">
                {networkLabel[0] || "S"}
              </div>
              <div>
                <div className="font-medium text-ink">{networkLabel}</div>
                <div className="text-xs text-ink-dim font-mono mt-1">Chain ID: {chainId}</div>
                {!isLive && <div className="text-[10px] text-ink-dim mt-1">RPC not connected — showing cached</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Wallet Balance Card */}
        <div className="bg-panel border border-line p-5 rounded-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-dim uppercase tracking-wider">Wallet Balance</span>
            <span className="text-xs font-mono text-ink-dim bg-line/50 px-2 py-0.5 rounded-sm border border-line">{walletShort}</span>
          </div>
          <div className="flex flex-col gap-3 mt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">ETH</span>
              <span className="font-mono text-ink tracking-tight">{ethBal}</span>
            </div>
            <div className="h-px w-full bg-line" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">WETH</span>
              <span className="font-mono text-ink tracking-tight">{wethBal}</span>
            </div>
            <div className="h-px w-full bg-line" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">USDC</span>
              <span className="font-mono text-ink tracking-tight">{usdcBal}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
