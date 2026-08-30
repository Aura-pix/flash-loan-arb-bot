export default function StatusRing() {
  return (
    <div className="flex items-center gap-3">
      {/* The ring itself */}
      <div className="relative w-4 h-4 rounded-full border border-line flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
      </div>
      {/* Text label */}
      <span className="text-xs font-mono text-ink-dim uppercase tracking-wider">
        Scanning
      </span>
    </div>
  );
}
