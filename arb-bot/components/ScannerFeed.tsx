"use client";

import { useEffect, useState } from "react";

type Scan = {
  id: number;
  ts: number;
  sushiPrice: number;
  uniPrice: number;
  spreadPct: number;
  loanSizeWeth: number;
  estimatedProfitWeth: number;
  thresholdWeth: number;
  gasPriceGwei: number;
};

export default function ScannerFeed() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScans = async () => {
      try {
        const res = await fetch("/api/scans");
        if (res.ok) {
          const data = await res.json();
          setScans(data.scans || []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchScans();
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-ink-dim font-mono text-sm">Loading feed...</div>;
  }

  return (
    <div className="w-full overflow-x-auto bg-panel border border-line rounded-sm">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b border-line text-ink-dim uppercase tracking-wider text-xs font-medium">
            <th className="px-6 py-4">Time</th>
            <th className="px-6 py-4 text-right">Spread %</th>
            <th className="px-6 py-4 text-right">Sushi Price</th>
            <th className="px-6 py-4 text-right">Uni Price</th>
            <th className="px-6 py-4 text-right">Est. Profit</th>
            <th className="px-6 py-4 text-right">Threshold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line font-mono text-xs">
          {scans.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center text-ink-dim">
                No scans recorded yet. Scanner may be paused.
              </td>
            </tr>
          ) : (
            scans.map((scan) => {
              const isProfitable = scan.estimatedProfitWeth > scan.thresholdWeth;
              return (
                <tr key={scan.id} className="hover:bg-bg transition-colors">
                  <td className="px-6 py-4 text-ink-dim">{new Date(scan.ts).toLocaleTimeString()}</td>
                  <td className="px-6 py-4 font-bold text-ink text-right">{scan.spreadPct.toFixed(4)}%</td>
                  <td className="px-6 py-4 text-ink text-right">${scan.sushiPrice.toFixed(2)}</td>
                  <td className="px-6 py-4 text-ink text-right">${scan.uniPrice.toFixed(2)}</td>
                  <td className={`px-6 py-4 text-right ${isProfitable ? 'text-good font-bold' : 'text-ink'}`}>
                    {scan.estimatedProfitWeth.toFixed(4)} WETH
                  </td>
                  <td className="px-6 py-4 text-ink-dim text-right">{scan.thresholdWeth.toFixed(4)} WETH</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
