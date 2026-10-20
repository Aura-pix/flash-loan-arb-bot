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
NETWORK=anvil-fork
DRY_RUN=true
PRIVATE_KEY=
SEPOLIA_RPC_URL=
ARBITRUM_RPC_URL=
CONTRACT_ADDRESS=
ARBITRUM_CONTRACT_ADDRESS=

# Optional scanner thresholds; defaults shown
MIN_LIQUIDITY_USD=100000
POOL_PCT=0.01
MIN_LOAN_WETH=0.05
MAX_LOAN_WETH=5
GAS_ESTIMATE_UNITS=450000
PROFIT_SAFETY_MULTIPLIER=2
MIN_PROFIT_FLOOR_WETH=0.001
SLIPPAGE_BUFFER_BPS=100
```

The scanner also loads `contracts/.env` and a `.env` in its working directory. The scanner configuration supports `anvil-fork`, `sepolia`, and `arbitrum`. The default fork configuration uses mainnet token/router addresses through a local RPC, so it requires a fork with those contracts available; a blank local chain will not work. For remote networks, set the matching RPC URL and verify that the configured contract and router addresses are correct for that network.

Start the scanner in another terminal, from this directory:

```powershell
node scanner-service/scanner.js
```

It checks pool liquidity and router quotes every 10 seconds, logs structured JSON events, and may request a flash loan when its estimated profit exceeds its threshold. Keep `DRY_RUN=true` while validating configuration: dry-run logs potential executions but does not send a transaction. A dry-run estimate is not evidence of a live opportunity or successful execution.

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
| `POST /api/execute` | Submit an optional JSON body such as `{ "amount": "0.5", "buyOnA": false }` |
| `GET /api/execute/status?txHash=...` | Read tracked execution status and steps |

The manual endpoint submits a contract request; it does not apply the scanner's estimated-profit threshold. Without a usable wallet/provider, the dashboard may show a local simulated execution flow. Such simulations are not blockchain transactions. Execution steps are tracked in the running Next.js process; scan and run history is stored separately in SQLite.

## SQLite data

The scanner and dashboard use `bot_data.sqlite` in this package directory when started from here. It stores `scans` and `runs` records. The dashboard API reads the database; run the scanner to populate it with new scan data. Do not delete or replace a database containing history you need to keep.

## Limitations

- The scanner is limited to WETH/USDC on the configured SushiSwap and Uniswap V2-style routers.
- Profit and gas calculations are estimates; prices, liquidity, fees, and gas can change before inclusion.
- Slippage protection does not prevent MEV, front-running, or sandwich attacks.
- The scanner does not currently have a dedicated automated JavaScript test suite.
- If live status information is unavailable, some dashboard cards display placeholder values. Verify balances against the selected network before acting.

For Solidity compilation, tests, and deployment notes, see the [contracts package README](../contracts/README.md).
