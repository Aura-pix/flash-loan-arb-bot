import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'bot_data.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
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
`);

export default db;
