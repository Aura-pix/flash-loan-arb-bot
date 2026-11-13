import db from './db';

export type ExecutionStatus = 'pending' | 'success' | 'reverted' | 'dry_run' | 'error';

export type ExecutionStep = {
  step: 'loan_taken' | 'swap_1' | 'swap_2' | 'repaid';
  gasUsedCumulative: number;
  timestamp: number;
};

export type ExecutionRecord = {
  txHash: string;
  status: ExecutionStatus;
  steps: ExecutionStep[];
  currentStep: number;
  startTime: number;
  updatedAt: number;
};

type ExecutionRow = {
  txHash: string;
  status: ExecutionStatus;
  steps: string;
  currentStep: number;
  startTime: number;
  updatedAt: number;
};

export function createExecution(
  txHash: string,
  status: ExecutionStatus,
  steps: ExecutionStep[] = []
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO executions (txHash, status, steps, currentStep, startTime, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(txHash) DO UPDATE SET
       status = excluded.status,
       steps = excluded.steps,
       currentStep = excluded.currentStep,
       updatedAt = excluded.updatedAt`
  ).run(txHash, status, JSON.stringify(steps), steps.length, now, now);
}

export function updateExecution(
  txHash: string,
  status: ExecutionStatus,
  steps: ExecutionStep[]
): void {
  db.prepare(
    `UPDATE executions
     SET status = ?, steps = ?, currentStep = ?, updatedAt = ?
     WHERE txHash = ?`
  ).run(status, JSON.stringify(steps), steps.length, Date.now(), txHash);
}

export function getExecution(txHash: string): ExecutionRecord | null {
  const row = db
    .prepare('SELECT * FROM executions WHERE txHash = ?')
    .get(txHash) as ExecutionRow | undefined;
  if (!row) return null;

  let steps: ExecutionStep[] = [];
  try {
    steps = JSON.parse(row.steps) as ExecutionStep[];
  } catch {
    steps = [];
  }

  return {
    txHash: row.txHash,
    status: row.status,
    steps,
    currentStep: row.currentStep,
    startTime: row.startTime,
    updatedAt: row.updatedAt,
  };
}
