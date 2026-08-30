export default function DashboardPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">Dashboard</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Bot Status Card */}
        <div className="bg-panel border border-line p-5 rounded-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-dim uppercase tracking-wider">Bot Status</span>
            <div className="flex items-center gap-2 bg-good/10 px-2.5 py-1 rounded-sm text-xs font-bold text-good uppercase tracking-wider border border-good/20">
              <div className="w-1.5 h-1.5 rounded-full bg-good"></div>
              Running
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-mono text-ink tracking-tight">ACTIVE</div>
            <div className="text-xs text-ink-dim mt-2">Watching WETH/USDC (Sushi vs UniV2)</div>
          </div>
        </div>

        {/* Network Selector Card */}
        <div className="bg-panel border border-line p-5 rounded-sm flex flex-col gap-4">
          <span className="text-sm font-medium text-ink-dim uppercase tracking-wider">Network</span>
          <div className="flex-1 flex flex-col justify-center mt-2">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-sm bg-line flex items-center justify-center text-sm font-bold text-ink border border-line shadow-inner">
                S
              </div>
              <div>
                <div className="font-medium text-ink">Sepolia Testnet</div>
                <div className="text-xs text-ink-dim font-mono mt-1">Chain ID: 11155111</div>
              </div>
            </div>
          </div>
        </div>

        {/* Wallet Balance Card */}
        <div className="bg-panel border border-line p-5 rounded-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-dim uppercase tracking-wider">Wallet Balance</span>
            <span className="text-xs font-mono text-ink-dim bg-line/50 px-2 py-0.5 rounded-sm border border-line">0x1234...ABCD</span>
          </div>
          <div className="flex flex-col gap-3 mt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">ETH</span>
              <span className="font-mono text-ink tracking-tight">0.5420</span>
            </div>
            <div className="h-px w-full bg-line" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">WETH</span>
              <span className="font-mono text-ink tracking-tight">1.2500</span>
            </div>
            <div className="h-px w-full bg-line" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">USDC</span>
              <span className="font-mono text-ink tracking-tight">2,450.00</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
