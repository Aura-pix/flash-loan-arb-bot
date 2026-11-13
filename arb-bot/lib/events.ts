import db from './db';

export type ScanCheckedData = {
  network: string;
  sushiPrice: number;
  uniPrice: number;
  spreadPct: number;
  loanSizeWeth: string | number;
  estimatedProfitWeth: number;
  thresholdWeth: number;
  gasPriceGwei: number;
};

export type RunData = {
  network: string;
  txHash?: string | null;
  status: 'success' | 'reverted' | 'error' | 'dry_run';
  gasUsed?: number | null;
  elapsedMs?: number | null;
  loanSizeWeth: string | number;
  profitWeth?: number | null;
};

const insertScan = db.prepare(
  'INSERT INTO scans (ts, network, sushiPrice, uniPrice, spreadPct, loanSizeWeth, estimatedProfitWeth, thresholdWeth, gasPriceGwei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

const insertRun = db.prepare(
  'INSERT INTO runs (ts, network, txHash, status, gasUsed, elapsedMs, loanSizeWeth, profitWeth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);

export function recordScan(data: ScanCheckedData, ts = Date.now()) {
  return insertScan.run(
    ts,
    data.network,
    data.sushiPrice,
    data.uniPrice,
    data.spreadPct,
    Number(data.loanSizeWeth),
    data.estimatedProfitWeth,
    data.thresholdWeth,
    data.gasPriceGwei
  );
}

export function recordRun(data: RunData, ts = Date.now()) {
  return insertRun.run(
    ts,
    data.network,
    data.txHash || null,
    data.status,
    data.gasUsed ?? null,
    data.elapsedMs ?? null,
    Number(data.loanSizeWeth),
    data.profitWeth ?? null
  );
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'string') {
    const t = new Date(value).getTime();
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function parseScannerLogLine(
  line: string
): { event: string; data: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (typeof parsed.event !== 'string') return null;
    return { event: parsed.event, data: parsed };
  } catch {
    return null;
  }
}

export function ingestLogLine(line: string) {
  const parsed = parseScannerLogLine(line);
  if (!parsed) return null;
  const { event, data } = parsed;

  if (event === 'scan_checked') {
    recordScan(
      {
        network: typeof data.network === 'string' ? data.network : 'unknown',
        sushiPrice: toNumber(data.sushiPrice),
        uniPrice: toNumber(data.uniPrice),
        spreadPct: toNumber(data.spreadPct),
        loanSizeWeth: toNumber(data.loanSizeWeth),
        estimatedProfitWeth: toNumber(data.estimatedProfitWeth),
        thresholdWeth: toNumber(data.thresholdWeth),
        gasPriceGwei: toNumber(data.gasPriceGwei),
      },
      toTimestamp(data.ts)
    );
    return event;
  }

  if (
    event === 'execute_success' ||
    event === 'execute_reverted' ||
    event === 'execute_error' ||
    event === 'dry_run_would_execute'
  ) {
    const statusMap: Record<string, RunData['status']> = {
      execute_success: 'success',
      execute_reverted: 'reverted',
      execute_error: 'error',
      dry_run_would_execute: 'dry_run',
    };
    const profitWeth =
      typeof data.profitWeth === 'number'
        ? data.profitWeth
        : typeof data.estimatedProfitWeth === 'number'
          ? data.estimatedProfitWeth
          : null;

    recordRun(
      {
        network: typeof data.network === 'string' ? data.network : 'unknown',
        txHash: toStringOrNull(data.hash) ?? toStringOrNull(data.txHash),
        status: statusMap[event] ?? 'error',
        gasUsed: data.gasUsed ? toNumber(data.gasUsed) : null,
        elapsedMs: data.elapsedMs ? toNumber(data.elapsedMs) : null,
        loanSizeWeth: toNumber(data.loanSizeWeth),
        profitWeth,
      },
      toTimestamp(data.ts)
    );
    return event;
  }

  return event;
}
