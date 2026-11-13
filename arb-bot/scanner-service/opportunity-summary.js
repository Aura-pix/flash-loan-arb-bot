import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

for (const envFile of [
  path.resolve(__dirname, "../.env.local"),
  path.resolve(__dirname, "../../contracts/.env"),
  path.resolve(process.cwd(), ".env"),
]) {
  dotenv.config({ path: envFile, quiet: true });
}
dotenv.config({ quiet: true });

const NETWORK = process.env.NETWORK || "base";
const dbPath = process.env.OPPORTUNITY_DB_PATH
  ? path.resolve(process.env.OPPORTUNITY_DB_PATH)
  : path.resolve(__dirname, "../opportunity_data.sqlite");

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (err) {
  console.error(`Could not open ${dbPath}: ${err.message}`);
  process.exit(1);
}

const rows = db
  .prepare("SELECT * FROM opportunities WHERE network = ? ORDER BY ts ASC")
  .all(NETWORK);

if (rows.length === 0) {
  console.log(`No opportunity samples for network "${NETWORK}" in ${dbPath}.`);
  process.exit(0);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmt(value, digits = 4) {
  return Number(value).toFixed(digits);
}

function netBps(row) {
  return (row.netProfitWeth / row.sizeWeth) * 10000;
}

function groupBy(rowsToGroup, keyFn) {
  const groups = new Map();
  for (const row of rowsToGroup) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function summarize(rowsToSummarize) {
  const positive = rowsToSummarize.filter((row) => row.netProfitWeth > 0);
  const best = rowsToSummarize.reduce((acc, row) =>
    !acc || row.netProfitWeth > acc.netProfitWeth ? row : acc
  , null);
  return {
    samples: rowsToSummarize.length,
    positive: positive.length,
    positivePct: (positive.length / rowsToSummarize.length) * 100,
    medianBps: median(rowsToSummarize.map(netBps)),
    bestNetWeth: best?.netProfitWeth ?? 0,
    bestNetUsd: best?.netProfitUsd ?? 0,
  };
}

const first = rows[0];
const last = rows[rows.length - 1];
const overall = summarize(rows);

console.log(`# Opportunity summary — ${NETWORK}`);
console.log("");
console.log(`Database: \`${dbPath}\``);
console.log(`Range: ${new Date(first.ts).toISOString()} → ${new Date(last.ts).toISOString()}`);
console.log(`Samples: ${overall.samples} | Positive: ${overall.positive} (${fmt(overall.positivePct, 1)}%) | Median net: ${fmt(overall.medianBps, 2)} bps | Best: ${fmt(overall.bestNetWeth, 6)} WETH ($${fmt(overall.bestNetUsd, 2)})`);
console.log("");

console.log("## By day");
console.log("");
console.log("| Day | Samples | Positive | Median net bps | Best net WETH | Best net USD |");
console.log("|---|---:|---:|---:|---:|---:|");
for (const [day, dayRows] of groupBy(rows, (row) => new Date(row.ts).toISOString().slice(0, 10))) {
  const s = summarize(dayRows);
  console.log(`| ${day} | ${s.samples} | ${s.positive} (${fmt(s.positivePct, 1)}%) | ${fmt(s.medianBps, 2)} | ${fmt(s.bestNetWeth, 6)} | ${fmt(s.bestNetUsd, 2)} |`);
}
console.log("");

console.log("## By size");
console.log("");
console.log("| Size (WETH) | Samples | Positive | Median net bps | Best net WETH |");
console.log("|---:|---:|---:|---:|---:|");
for (const [size, sizeRows] of groupBy(rows, (row) => row.sizeWeth)) {
  const s = summarize(sizeRows);
  console.log(`| ${size} | ${s.samples} | ${s.positive} (${fmt(s.positivePct, 1)}%) | ${fmt(s.medianBps, 2)} | ${fmt(s.bestNetWeth, 6)} |`);
}
console.log("");

console.log("## By route pair");
console.log("");
console.log("| Sell | Buy | Samples | Positive | Median net bps | Best net WETH |");
console.log("|---|---|---:|---:|---:|---:|");
const routeGroups = groupBy(rows, (row) => `${row.sellVenue}:${row.sellFee ?? "v2"} -> ${row.buyVenue}:${row.buyFee ?? "v2"}`);
const routeSummary = [...routeGroups.entries()]
  .map(([key, routeRows]) => ({ key, ...summarize(routeRows) }))
  .sort((a, b) => b.medianBps - a.medianBps)
  .slice(0, 15);
for (const route of routeSummary) {
  const [sell, buy] = route.key.split(" -> ");
  console.log(`| ${sell} | ${buy} | ${route.samples} | ${route.positive} (${fmt(route.positivePct, 1)}%) | ${fmt(route.medianBps, 2)} | ${fmt(route.bestNetWeth, 6)} |`);
}
console.log("");

console.log("## Top 10 samples");
console.log("");
console.log("| Time | Size | Sell | Buy | Net WETH | Net USD | Net bps |");
console.log("|---|---:|---|---|---:|---:|---:|");
const top = [...rows].sort((a, b) => b.netProfitWeth - a.netProfitWeth).slice(0, 10);
for (const row of top) {
  console.log(`| ${new Date(row.ts).toISOString()} | ${row.sizeWeth} | ${row.sellVenue}:${row.sellFee ?? "v2"} | ${row.buyVenue}:${row.buyFee ?? "v2"} | ${fmt(row.netProfitWeth, 6)} | ${fmt(row.netProfitUsd, 2)} | ${fmt(netBps(row), 2)} |`);
}

db.close();
