"use client";
import { useEffect, useState } from "react";

type StatusData = {
  lastScan: { ts: number; isOpportunity: boolean } | null;
  lastRun: { status: string } | null;
  scanning: boolean;
  dryRun: boolean;
};

export default function StatusRing() {
  const [progress, setProgress] = useState(0);
  const [opportunity, setOpportunity] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [label, setLabel] = useState("Scanning");

  useEffect(() => {
    let lastTs = 0;
    let raf: number;

    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) {
          const data: StatusData = await res.json();
          if (data.lastScan) {
            lastTs = data.lastScan.ts;
            setOpportunity(data.lastScan.isOpportunity);
          }
          setExecuting(data.lastRun?.status === "pending" || false);
          if (data.dryRun) setLabel("Dry-run");
          else if (data.lastScan?.isOpportunity) setLabel("Opportunity");
          else if (executing) setLabel("Executing");
          else setLabel("Scanning");
        }
      } catch {}
    };

    fetchStatus();
    const id = setInterval(fetchStatus, 3000);

    const tick = () => {
      if (lastTs) {
        const elapsed = Date.now() - lastTs;
        const pct = Math.min((elapsed % 10000) / 10000, 1);
        setProgress(pct);
      } else {
        setProgress((p) => (p + 0.008) % 1);
      }
      raf = requestAnimationFrame(tick);
    };
    // Use interval for progress instead of rAF to avoid tight loop
    const progId = setInterval(() => {
      if (lastTs) {
        const pct = Math.min(((Date.now() - lastTs) % 10000) / 10000, 1);
        setProgress(pct);
      } else {
        setProgress((p) => (p + 0.02) % 1);
      }
    }, 100);

    return () => {
      clearInterval(id);
      clearInterval(progId);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [executing]);

  const circumference = 2 * Math.PI * 7;
  const offset = circumference * (1 - progress);
  const ringColor = opportunity ? "#4CAF7D" : executing ? "#C08A3E" : "#2A3040";
  const dotColor = opportunity ? "bg-good" : executing ? "bg-accent animate-pulse" : "bg-accent";

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-7 h-7 flex items-center justify-center">
        <svg className="w-7 h-7 -rotate-90" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7" stroke="#2A3040" strokeWidth="1.2" fill="none" />
          <circle
            cx="8"
            cy="8"
            r="7"
            stroke={ringColor}
            strokeWidth="1.2"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.1s linear, stroke 0.3s" }}
          />
        </svg>
        <div className={`absolute w-2 h-2 rounded-full ${dotColor} ${executing ? "animate-pulse" : ""}`} />
      </div>
      <span className="text-xs font-mono text-ink-dim uppercase tracking-wider hidden sm:inline">
        {label}
      </span>
    </div>
  );
}
