"use client";

import { useState, useEffect } from "react";

type StepName = 'loan_taken' | 'swap_1' | 'swap_2' | 'repaid';

type StepData = {
  step: StepName;
  gasUsedCumulative: number;
  timestamp: number;
};

const ALL_STEPS: { id: StepName; label: string }[] = [
  { id: 'loan_taken', label: 'Flash Loan Borrowed' },
  { id: 'swap_1', label: 'Swap A (SushiSwap)' },
  { id: 'swap_2', label: 'Swap B (Uniswap V2)' },
  { id: 'repaid', label: 'Flash Loan Repaid' }
];

export default function StepsBreakdown() {
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'reverted' | 'dry_run'>('idle');
  const [completedSteps, setCompletedSteps] = useState<StepData[]>([]);

  const triggerExecution = async () => {
    setStatus('pending');
    setCompletedSteps([]);
    try {
      const res = await fetch('/api/execute', { method: 'POST' });
      const data = await res.json();
      if (data.txHash) {
        setTxHash(data.txHash);
      } else {
        setStatus('reverted');
      }
    } catch (e) {
      console.error(e);
      setStatus('reverted');
    }
  };

  useEffect(() => {
    if (!txHash || status === 'success' || status === 'reverted' || status === 'dry_run') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/execute/status?txHash=${txHash}`);
        if (res.ok) {
          const data = await res.json();
          setCompletedSteps(data.steps || []);
          if (data.status !== 'pending') {
            setStatus(data.status);
          }
        }
      } catch (e) {
        console.error("Polling error", e);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [txHash, status]);

  return (
    <div className="bg-panel border border-line rounded-sm p-8 flex flex-col gap-8">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <h3 className="font-display text-lg font-bold text-ink tracking-tight uppercase">Execution Engine</h3>
        {status === 'idle' && (
          <button 
            onClick={triggerExecution}
            className="bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 px-6 py-2 rounded-sm font-bold text-sm tracking-widest uppercase transition-colors cursor-pointer"
          >
            Trigger Manual Run
          </button>
        )}
        {status === 'pending' && (
          <div className="flex items-center gap-2 text-accent text-sm font-bold uppercase tracking-widest">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            Executing on-chain
          </div>
        )}
        {(status === 'success' || status === 'reverted' || status === 'dry_run') && (
          <button 
            onClick={() => { setStatus('idle'); setTxHash(null); setCompletedSteps([]); }}
            className="text-ink-dim hover:text-ink text-sm font-bold uppercase tracking-widest underline decoration-line underline-offset-4 cursor-pointer"
          >
            Reset
          </button>
        )}
      </div>

      <div className="flex flex-col gap-6 relative ml-2">
        {ALL_STEPS.map((stepInfo, index) => {
          const stepData = completedSteps.find(s => s.step === stepInfo.id);
          const isComplete = !!stepData;
          const isNext = status === 'pending' && completedSteps.length === index;

          return (
            <div key={stepInfo.id} className="flex items-start gap-6 relative z-10">
              <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center bg-panel ${
                isComplete ? 'border-good' : isNext ? 'border-accent' : 'border-line'
              }`}>
                {isComplete && <div className="w-2.5 h-2.5 rounded-full bg-good" />}
                {isNext && <div className="w-2.5 h-2.5 rounded-full bg-accent animate-ping" />}
              </div>
              <div className="flex-1">
                <div className={`font-medium tracking-wide ${isComplete ? 'text-good' : isNext ? 'text-accent' : 'text-ink-dim'}`}>
                  {stepInfo.label}
                </div>
                {stepData && (
                  <div className="text-xs font-mono text-ink-dim mt-1.5 flex gap-4">
                    <span>Gas Cumulative: <span className="text-ink">{stepData.gasUsedCumulative.toLocaleString()}</span></span>
                    <span>Time: <span className="text-ink">{new Date(stepData.timestamp).toISOString().split('T')[1].replace('Z','')}</span></span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {/* Connecting line */}
        <div className="absolute left-2.5 top-2 bottom-8 w-px bg-line -z-0 transform -translate-x-1/2" />
      </div>

      {status === 'success' && (
        <div className="mt-4 p-5 border border-good/30 bg-good/5 rounded-sm flex flex-col gap-3">
          <div className="text-good font-bold uppercase tracking-widest text-sm flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Arbitrage Successful
          </div>
          <div className="font-mono text-xs text-ink-dim">TxHash: <span className="text-ink">{txHash}</span></div>
        </div>
      )}
      {status === 'dry_run' && (
        <div className="mt-4 p-5 border border-accent/30 bg-accent/5 rounded-sm flex flex-col gap-3">
          <div className="text-accent font-bold uppercase tracking-widest text-sm flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01" /></svg>
            Dry-Run — No Transaction Sent
          </div>
          <div className="font-mono text-xs text-ink-dim">DRY_RUN=true — sizing/profit logged, would have executed with these steps. TxHash: <span className="text-ink">{txHash}</span></div>
        </div>
      )}
      {status === 'reverted' && (
        <div className="mt-4 p-5 border border-bad/30 bg-bad/5 rounded-sm flex flex-col gap-3">
          <div className="text-bad font-bold uppercase tracking-widest text-sm flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            Execution Reverted
          </div>
          <div className="font-mono text-xs text-ink-dim">TxHash: <span className="text-ink">{txHash || '—'}</span></div>
        </div>
      )}
    </div>
  );
}
