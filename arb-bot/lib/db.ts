import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'bot_data.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    network TEXT,
    sushiPrice REAL NOT NULL,
    uniPrice REAL NOT NULL,
    spreadPct REAL NOT NULL,
    loanSizeWeth REAL NOT NULL,
    estimatedProfitWeth REAL NOT NULL,
    thresholdWeth REAL NOT NULL,
    gasPriceGwei REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    network TEXT NOT NULL,
    txHash TEXT,
    status TEXT NOT NULL,
    gasUsed INTEGER,
    elapsedMs INTEGER,
    loanSizeWeth REAL NOT NULL,
    profitWeth REAL
  );

  CREATE TABLE IF NOT EXISTS executions (
    txHash TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    steps TEXT NOT NULL,
    currentStep INTEGER NOT NULL,
    startTime INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
`);

// SQLite has no `ADD COLUMN IF NOT EXISTS`; migrate older databases in place.
const scanColumns = db
  .prepare('PRAGMA table_info(scans)')
  .all() as { name: string }[];
if (!scanColumns.some((column) => column.name === 'network')) {
  try {
    db.exec('ALTER TABLE scans ADD COLUMN network TEXT');
  } catch {
    // Another process may have migrated the table concurrently.
  }
}

export default db;
