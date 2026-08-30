import { ethers } from 'ethers';
import path from 'path';
import Database from 'better-sqlite3';

// ── Network config (mirrors contracts/scripts/scanner.js) ─
const NETWORK = process.env.NETWORK || 'anvil-fork';
const DRY_RUN = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';

const CONFIG: Record<string, { rpcUrl: string; WETH: string; CONTRACT_ADDRESS: string }> = {
  'anvil-fork': {
    rpcUrl: 'http://127.0.0.1:8545',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    CONTRACT_ADDRESS: '0x1C33Db5FC563ac9732C5352c37B73d95b7015E6f',
  },
  sepolia: {
    rpcUrl: process.env.SEPOLIA_RPC_URL || '',
    WETH: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || '0x77EC85E9b7fBcE5365a234F6FE826d7740FB517f',
  },
};

function getCfg() {
  return CONFIG[NETWORK] || CONFIG['anvil-fork'];
}

function getProvider() {
  const cfg = getCfg();
  if (!cfg.rpcUrl) return null;
  try { return new ethers.JsonRpcProvider(cfg.rpcUrl); } catch { return null; }
}

function getWallet() {
  const pk = process.env.PRIVATE_KEY;
  const provider = getProvider();
  if (!pk || !provider) return null;
  try { return new ethers.Wallet(pk, provider); } catch { return null; }
}

const ABI = [
  'function requestFlashLoan(address token, uint256 amount, bool buyOnA) external',
  'event LoanExecuted(address indexed token, uint256 amount, bool buyOnA)',
  'event StepCompleted(string step, uint256 amountOut)',
  'event ArbitrageResult(bool profitable, uint256 profit)',
];

export type StepName = 'loan_taken' | 'swap_1' | 'swap_2' | 'repaid';
export type StepData = { step: StepName; gasUsedCumulative: number; timestamp: number };

export const activeSimulations = new Map<string, {
  status: 'pending' | 'success' | 'reverted' | 'dry_run';
  steps: StepData[];
  currentStep: number;
  startTime: number;
  txHash: string;
}>();

function getDb() {
  try {
    const dbPath = path.join(process.cwd(), 'bot_data.sqlite');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, network TEXT NOT NULL, txHash TEXT, status TEXT NOT NULL, gasUsed INTEGER, elapsedMs INTEGER, loanSizeWeth REAL NOT NULL, profitWeth REAL)`);
    return db;
  } catch { return null; }
}

export async function requestFlashLoan(amountWeth?: string, buyOnA?: boolean): Promise<string> {
  const cfg = getCfg();
  const loanSizeWeth = amountWeth || '0.5';
  const buyOnAFlag = buyOnA ?? false;

  // Dry-run short-circuit — no tx, log to DB, return synthetic hash
  if (DRY_RUN) {
    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const now = Date.now();
    activeSimulations.set(txHash, {
      status: 'dry_run',
      steps: [
        { step: 'loan_taken', gasUsedCumulative: 0, timestamp: now },
        { step: 'swap_1', gasUsedCumulative: 0, timestamp: now + 100 },
        { step: 'swap_2', gasUsedCumulative: 0, timestamp: now + 200 },
        { step: 'repaid', gasUsedCumulative: 0, timestamp: now + 300 },
      ],
      currentStep: 4,
      startTime: now,
      txHash,
    });
    try {
      const db = getDb();
      db?.prepare('INSERT INTO runs (ts, network, txHash, status, gasUsed, elapsedMs, loanSizeWeth, profitWeth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(Date.now(), NETWORK, txHash, 'dry_run', null, 0, Number(loanSizeWeth), null);
    } catch {}
    return txHash;
  }

  const provider = getProvider();
  const wallet = getWallet();

  // Fallback to simulation if no live wallet/provider (dev without node)
  if (!provider || !wallet) {
    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const now = Date.now();
    activeSimulations.set(txHash, { status: 'pending', steps: [], currentStep: 0, startTime: now, txHash });
    simulateSteps(txHash);
    return txHash;
  }

  const contract = new ethers.Contract(cfg.CONTRACT_ADDRESS, ABI, wallet);
  let amountWei: bigint;
  try { amountWei = ethers.parseUnits(loanSizeWeth, 18); } catch { amountWei = ethers.parseUnits('0.5', 18); }

  const tx = await contract.requestFlashLoan(cfg.WETH, amountWei, buyOnAFlag, { gasLimit: 500000 });
  const txHash: string = tx.hash;
  const startTime = Date.now();
  activeSimulations.set(txHash, { status: 'pending', steps: [], currentStep: 0, startTime, txHash });

  // Background: wait for receipt and populate steps
  (async () => {
    try {
      const receipt = await tx.wait();
      const sim = activeSimulations.get(txHash);
      if (!sim) return;
      const gasUsed = Number(receipt.gasUsed);
      const ts = Date.now();
      if (receipt.status === 1) {
        // Derive steps from receipt events if present, else synthesize 4 steps
        let steps: StepData[] = [];
        try {
          const iface = new ethers.Interface(ABI);
          const stepEvents = receipt.logs.map((l: any) => { try { return iface.parseLog(l); } catch { return null; } }).filter(Boolean);
          const hasLoan = stepEvents.some((e: any) => e.name === 'LoanExecuted');
          const swapCount = stepEvents.filter((e: any) => e.name === 'StepCompleted').length;
          const hasResult = stepEvents.some((e: any) => e.name === 'ArbitrageResult');
          if (hasLoan || swapCount > 0) {
            let idx = 0;
            if (hasLoan) steps.push({ step: 'loan_taken', gasUsedCumulative: Math.floor(gasUsed * 0.2), timestamp: ts });
            if (swapCount >= 1) steps.push({ step: 'swap_1', gasUsedCumulative: Math.floor(gasUsed * 0.5), timestamp: ts + 50 });
            if (swapCount >= 2) steps.push({ step: 'swap_2', gasUsedCumulative: Math.floor(gasUsed * 0.8), timestamp: ts + 100 });
            if (hasResult) steps.push({ step: 'repaid', gasUsedCumulative: gasUsed, timestamp: ts + 150 });
            if (steps.length === 0) steps = synthSteps(gasUsed, ts);
          } else {
            steps = synthSteps(gasUsed, ts);
          }
        } catch {
          steps = synthSteps(gasUsed, ts);
        }
        sim.steps = steps;
        sim.currentStep = steps.length;
        sim.status = 'success';
        try {
          const db = getDb();
          const profit = (() => { try { const ev = receipt.logs.find((l:any)=>{try{return new ethers.Interface(ABI).parseLog(l)?.name==='ArbitrageResult'}catch{return false}}); if(ev){const parsed=new ethers.Interface(ABI).parseLog(ev); if(parsed) return Number(ethers.formatUnits(parsed.args[1],18));} return null;} catch{return null}})();
          db?.prepare('INSERT INTO runs (ts, network, txHash, status, gasUsed, elapsedMs, loanSizeWeth, profitWeth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(Date.now(), NETWORK, txHash, 'success', gasUsed, Date.now() - startTime, Number(loanSizeWeth), profit);
        } catch {}
      } else {
        sim.status = 'reverted';
        sim.steps = synthSteps(gasUsed, ts).slice(0, 1);
        sim.currentStep = sim.steps.length;
        try { const db=getDb(); db?.prepare('INSERT INTO runs (ts, network, txHash, status, gasUsed, elapsedMs, loanSizeWeth, profitWeth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(Date.now(), NETWORK, txHash, 'reverted', gasUsed, Date.now()-startTime, Number(loanSizeWeth), null);} catch{}
      }
    } catch (e: any) {
      const sim = activeSimulations.get(txHash);
      if (sim) { sim.status = 'reverted'; }
      try { const db=getDb(); db?.prepare('INSERT INTO runs (ts, network, txHash, status, gasUsed, elapsedMs, loanSizeWeth, profitWeth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(Date.now(), NETWORK, txHash, 'error', null, Date.now()-startTime, Number(loanSizeWeth), null);} catch{}
    }
  })();

  return txHash;
}

function synthSteps(gasUsed: number, ts: number): StepData[] {
  return [
    { step: 'loan_taken', gasUsedCumulative: Math.floor(gasUsed * 0.25), timestamp: ts },
    { step: 'swap_1', gasUsedCumulative: Math.floor(gasUsed * 0.55), timestamp: ts + 40 },
    { step: 'swap_2', gasUsedCumulative: Math.floor(gasUsed * 0.85), timestamp: ts + 80 },
    { step: 'repaid', gasUsedCumulative: gasUsed, timestamp: ts + 120 },
  ];
}

async function simulateSteps(txHash: string) {
  const sim = activeSimulations.get(txHash);
  if (!sim) return;
  const steps: StepName[] = ['loan_taken', 'swap_1', 'swap_2', 'repaid'];
  for (let i = 0; i < steps.length; i++) {
    await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));
    const cur = activeSimulations.get(txHash);
    if (!cur) return;
    cur.steps.push({ step: steps[i], gasUsedCumulative: 150000 + Math.floor(Math.random() * 50000) + i * 60000, timestamp: Date.now() });
    cur.currentStep = cur.steps.length;
  }
  const final = activeSimulations.get(txHash);
  if (final) final.status = 'success';
}
