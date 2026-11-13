# 0xAurora Dashboard and Scanner

This package contains the 0xAurora Next.js dashboard, its API routes, the standalone market scanner, and the SQLite database used to display scan and execution history. For the full system overview and repository setup, see the [root README](../README.md).

## Requirements

- Node.js compatible with Next.js 16 and npm
- An RPC endpoint for the selected network when reading live data or sending transactions
- For the default `anvil-fork` configuration, a local mainnet-fork node at `http://127.0.0.1:8545`

## Install and start the dashboard

Run commands from this directory:

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Other package scripts are:

```powershell
npm run build
npm run start
npm run lint
```

`start` runs the production build; run `npm run build` first.

## Configure the scanner

Create `.env.local` in this directory. Keep credentials private and do not commit real private keys or RPC tokens.

```dotenv
NETWORK=base
DRY_RUN=true
PRIVATE_KEY=
BASE_RPC_URL=
ARBITRUM_RPC_URL=
SEPOLIA_RPC_URL=
BASE_CONTRACT_ADDRESS=
ARBITRUM_CONTRACT_ADDRESS=
CONTRACT_ADDRESS=

# Manual execution is disabled unless explicitly enabled and authenticated.
EXECUTOR_ENABLED=false
EXECUTOR_TOKEN=
ENABLE_LIVE_EXECUTION=false

# Optional scanner thresholds; defaults shown
MIN_LIQUIDITY_USD=100000
POOL_PCT=0.01
MIN_LOAN_WETH=0.05
MAX_LOAN_WETH=5
GAS_ESTIMATE_UNITS=450000
PROFIT_SAFETY_MULTIPLIER=2
MIN_PROFIT_FLOOR_WETH=0.001
MIN_NET_PROFIT_WETH=0.0005
SLIPPAGE_BUFFER_BPS=100
EXPECTED_SLIPPAGE_BPS=20
# Blank uses the network default (USDC on Base, USDC.e on Arbitrum)
QUOTE_TOKEN=
```

The scanner also loads `contracts/.env` and a `.env` in its working directory. The scanner configuration supports `anvil-fork`, `sepolia`, `arbitrum`, and `base`. The default fork configuration uses mainnet token/router addresses through a local RPC, so it requires a fork with those contracts available; a blank local chain will not work. For remote networks, set the matching RPC URL and verify that the configured contract and router addresses are correct for that network. Base currently has one deep V2 venue (Uniswap V2) and no second liquid V2 venue; the V2/V3 receiver needed for Base is the next phase. Until then, a Base scanner run will log `scan_skipped_low_liquidity`.

Start the scanner in another terminal, from this directory:

```powershell
node scanner-service/scanner.js
```

It checks pool liquidity and router quotes every 10 seconds, logs structured JSON events, and may request a flash loan when its estimated profit exceeds its threshold. Keep `DRY_RUN=true` while validating configuration: dry-run logs potential executions but does not send a transaction. A dry-run estimate is not evidence of a live opportunity or successful execution.

## Opportunity measurement (read-only)

Before enabling a new venue or pair, run the collector for several days. It reads pool state and quoter results, writes samples to `opportunity_data.sqlite`, and never sends a transaction.

```powershell
npm run collect
```

Default venues on Base are `uniswap-v2`, `uniswap-v3`, and `pancake-v3`; every configured V3 fee tier is sampled. Each cycle rotates through `COLLECT_SIZES_WETH`. The collector computes the exact sell leg and the exact buy-back leg for that output, then subtracts gas, an L1-fee estimate, and a safety margin.

```dotenv
COLLECT_INTERVAL_MS=60000
COLLECT_SIZES_WETH=0.1,0.25,0.5,1,2,5
COLLECT_VENUES=
COLLECT_CONCURRENCY=2
L1_FEE_WETH=0.00005
SAFETY_MARGIN_BPS=20
OPPORTUNITY_DB_PATH=
```

Generate a summary at any time:

```powershell
npm run collect:summary
```

The summary reports samples per day, positive-sample rate, median net bps, the best net WETH/USD, per-size results, the best route pairs, and the top samples. Use a 7-day run before deciding whether a venue/pair clears costs.

## Dashboard routes

| Route | Description |
| --- | --- |
| `/` | Network, wallet, and latest scan status |
| `/scanner` | Recent scanner checks |
| `/execute` | Manually submit a loan request and view tracked steps |
| `/logs` | Recent execution history |

API routes:

| Method and route | Description |
| --- | --- |
| `GET /api/status` | Network, RPC status, wallet balances, and latest scan/run |
| `GET /api/scans?limit=50` | Recent scan records |
| `GET /api/logs?limit=50` | Recent run records |
| `POST /api/execute` | Manual execution; requires `EXECUTOR_ENABLED=true`, `EXECUTOR_TOKEN`, and the `x-executor-token` header. Body: `{ "amount": "0.05", "buyOnA": true }` |
| `GET /api/execute/status?txHash=...` | Read tracked execution status and steps |

The manual endpoint submits a contract request; it does not apply the scanner's estimated-profit threshold. It is disabled by default and requires a server-side token. Without a usable wallet/provider, a live request fails closed rather than simulating success. Execution steps are persisted in SQLite and tracked per transaction; scan and run history is stored separately.

## SQLite data

The scanner and dashboard use `bot_data.sqlite` in this package directory when started from here. It stores `scans` and `runs` records. The dashboard API reads the database; run the scanner to populate it with new scan data. Do not delete or replace a database containing history you need to keep.

## Limitations

- The current scanner is limited to WETH/USDC on the first two configured Uniswap-V2-style venues. On Base, the second V2 venue is too thin; the V2/V3 receiver and scanner are the next phase.
- The dashboard filters scan/run history by the configured `NETWORK` so rows from different chains do not mix.
- Profit and gas calculations are estimates; prices, liquidity, fees, and gas can change before inclusion.
- Slippage protection does not prevent MEV, front-running, or sandwich attacks.
- The scanner does not currently have a dedicated automated JavaScript test suite.
- If live status information is unavailable, some dashboard cards display placeholder values. Verify balances against the selected network before acting.

For Solidity compilation, tests, and deployment notes, see the [contracts package README](../contracts/README.md).
