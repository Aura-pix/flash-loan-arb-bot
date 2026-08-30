import db from './db';

export type ScanCheckedData = {
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
  'INSERT INTO scans (ts, sushiPrice, uniPrice, spreadPct, loanSizeWeth, estimatedProfitWeth, thresholdWeth, gasPriceGwei) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);

const insertRun = db.prepare(
  'INSERT INTO runs (ts, network, txHash, status, gasUsed, elapsedMs, loanSizeWeth, profitWeth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);

export function recordScan(data: ScanCheckedData, ts = Date.now()) {
  return insertScan.run(
    ts,
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

export function parseScannerLogLine(line: string): { event: string; data: any } | null {
  try {
    const obj = JSON.parse(line);
    if (!obj.event) return null;
    return { event: obj.event, data: obj };
  } catch {
    return null;
  }
}

export function ingestLogLine(line: string) {
  const parsed = parseScannerLogLine(line);
  if (!parsed) return null;
  const { event, data } = parsed;
  if (event === 'scan_checked') {
    recordScan({
      sushiPrice: data.sushiPrice,
      uniPrice: data.uniPrice,
      spreadPct: data.spreadPct,
      loanSizeWeth: data.loanSizeWeth,
      estimatedProfitWeth: data.estimatedProfitWeth,
      thresholdWeth: data.thresholdWeth,
      gasPriceGwei: data.gasPriceGwei,
    }, new Date(data.ts).getTime() || Date.now());
    return event;
  }
  if (event === 'execute_success' || event === 'execute_reverted' || event === 'execute_error' || event === 'dry_run_would_execute') {
    const statusMap: Record<string, RunData['status']> = {
      execute_success: 'success',
      execute_reverted: 'reverted',
      execute_error: 'error',
      dry_run_would_execute: 'dry_run',
    };
    recordRun({
      network: data.network,
      txHash: data.hash || data.txHash || null,
      status: statusMap[event],
      gasUsed: data.gasUsed ? Number(data.gasUsed) : null,
      elapsedMs: data.elapsedMs || null,
      loanSizeWeth: data.loanSizeWeth || 0,
      profitWeth: data.profitWeth ?? data.estimatedProfitWeth ?? null,
    }, new Date(data.ts).getTime() || Date.now());
    return event;
  }
  return event;
}
