"use client";

import { useEffect, useRef, useState } from "react";

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
  const lastTsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data: StatusData = await res.json();
        if (cancelled) return;

        if (data.lastScan) {
          lastTsRef.current = data.lastScan.ts;
          setOpportunity(data.lastScan.isOpportunity);
        }

        const isExecuting = data.lastRun?.status === "pending";
        setExecuting(isExecuting);

        if (data.dryRun) setLabel("Dry-run");
        else if (data.lastScan?.isOpportunity) setLabel("Opportunity");
        else if (isExecuting) setLabel("Executing");
        else setLabel("Scanning");
      } catch {
        // Keep the last known state when the API is unreachable.
      }
    };

    fetchStatus();
    const id = setInterval(fetchStatus, 3000);
    const progId = setInterval(() => {
      if (lastTsRef.current) {
        setProgress(
          Math.min(((Date.now() - lastTsRef.current) % 10000) / 10000, 1)
        );
      } else {
        setProgress((p) => (p + 0.02) % 1);
      }
    }, 100);

    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(progId);
    };
  }, []);

  const circumference = 2 * Math.PI * 7;
  const offset = circumference * (1 - progress);
  const ringColor = opportunity ? "#4CAF7D" : executing ? "#C08A3E" : "#2A3040";
  const dotColor = opportunity
    ? "bg-good"
    : executing
      ? "bg-accent animate-pulse"
      : "bg-accent";

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
            style={{
              transition: "stroke-dashoffset 0.1s linear, stroke 0.3s",
            }}
          />
        </svg>
        <div
          className={`absolute w-2 h-2 rounded-full ${dotColor} ${
            executing ? "animate-pulse" : ""
          }`}
        />
      </div>
      <span className="text-xs font-mono text-ink-dim uppercase tracking-wider hidden sm:inline">
        {label}
      </span>
    </div>
  );
}
