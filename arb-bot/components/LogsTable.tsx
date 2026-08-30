"use client";

import { useEffect, useState } from "react";

type Run = {
  id: number;
  ts: number;
  network: string;
  txHash: string;
  status: "success" | "reverted" | "error";
  gasUsed: number;
  elapsedMs: number;
  loanSizeWeth: number;
  profitWeth: number | null;
};

export default function LogsTable() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const res = await fetch("/api/logs");
        if (res.ok) {
          const data = await res.json();
          setRuns(data.runs || []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchRuns();
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-ink-dim font-mono text-sm">Loading logs...</div>;
  }

  return (
    <div className="w-full overflow-x-auto bg-panel border border-line rounded-sm">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b border-line text-ink-dim uppercase tracking-wider text-xs font-medium">
            <th className="px-6 py-4">Time</th>
            <th className="px-6 py-4">Network</th>
            <th className="px-6 py-4">Status</th>
            <th className="px-6 py-4 text-right">Loan (WETH)</th>
            <th className="px-6 py-4 text-right">Profit (WETH)</th>
            <th className="px-6 py-4">Tx Hash</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line font-mono text-xs">
          {runs.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center text-ink-dim">
                No runs recorded yet. Awaiting execution.
              </td>
            </tr>
          ) : (
            runs.map((run) => (
              <tr key={run.id} className="hover:bg-bg transition-colors">
                <td className="px-6 py-4 text-ink-dim">{new Date(run.ts).toLocaleString()}</td>
                <td className="px-6 py-4 text-ink">{run.network}</td>
                <td className="px-6 py-4">
                  <span className={`px-2.5 py-1 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${
                    run.status === 'success' ? 'bg-good/10 text-good border-good/20' : 
                    'bg-bad/10 text-bad border-bad/20'
                  }`}>
                    {run.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-ink text-right">{run.loanSizeWeth.toFixed(4)}</td>
                <td className={`px-6 py-4 text-right font-bold ${run.profitWeth && run.profitWeth > 0 ? 'text-good' : 'text-bad'}`}>
                  {run.profitWeth ? `+${run.profitWeth.toFixed(4)}` : '0.0000'}
                </td>
                <td className="px-6 py-4 text-ink-dim">
                  {run.txHash ? `${run.txHash.substring(0, 6)}...${run.txHash.substring(run.txHash.length - 4)}` : '-'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
