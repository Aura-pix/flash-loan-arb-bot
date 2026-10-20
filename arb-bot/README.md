# 0xAurora — Flash-Loan Arbitrage Bot

0xAurora is an experimental arbitrage system with a Next.js monitoring dashboard, an off-chain DEX scanner, and a Solidity flash-loan receiver. The scanner monitors the WETH/USDC markets on SushiSwap and Uniswap V2, estimates whether a price difference could cover swap costs and gas, and can request an atomic Balancer V2 flash loan to execute both swaps.

This repository is a development project, not a turnkey or guaranteed-profitable trading service. Begin with a local fork or test network and dry-run mode. Do not use funds you cannot afford to lose.

## Project layout

The repository has two separately installed Node.js packages:

```text
arb-bot/                         # Next.js dashboard and scanner service
  app/                           # Dashboard pages and API routes
  components/                    # Dashboard, scanner, log, and execution UI
  lib/                           # Ethers integration and SQLite access
  scanner-service/scanner.js     # Long-running off-chain scanner
  bot_data.sqlite                # Runtime scan and execution history
contracts/                       # Hardhat project and Solidity contract
  contracts/FlashLoanReceiver.sol
  contracts/FlashLoanReceiver.t.sol
  mocks/                         # Test token, router, and vault
  scripts/                       # Deployment, scanning, and simulation scripts
```

The dashboard and `scanner-service` share `arb-bot/bot_data.sqlite` when both are started from the `arb-bot` directory. The Hardhat project is independent and has its own dependencies and environment file.

## How it works

1. **Scan:** Every 10 seconds, the scanner reads SushiSwap and Uniswap V2 WETH/USDC pool reserves and router quotes.
2. **Estimate:** It sizes a candidate loan from the shallower pool, within configured minimum and maximum limits, and estimates profit after swap fees and a slippage buffer. The execution threshold is based on estimated gas cost and a configurable minimum profit floor.
3. **Execute:** If estimated profit exceeds the threshold, the scanner requests a Balancer V2 flash loan. The contract swaps across the two DEX routers, checks that it can repay the loan and fee, repays Balancer, and emits execution events. The scanner withdraws any remaining WETH after a successful run.
4. **Record and display:** Scan and run records are stored in SQLite. The dashboard reads this data through its API and displays status, scan history, execution steps, and past runs.

The dashboard also has a manual execution panel. A manual request is not the same as an opportunity-approved scanner trade: the scanner's profit threshold is evaluated by the scanner loop, not by the contract's manual execution endpoint.

## Requirements

- Node.js compatible with Next.js 16 and npm
- An RPC endpoint for the selected network
- A funded development/test wallet for live contract operations
- A local fork node at `http://127.0.0.1:8545` when using the default `anvil-fork` network

## Install

Install each package from its own directory:

```powershell
cd arb-bot
npm install

cd ..\contracts
npm install
```

## Configuration

The dashboard and `scanner-service/scanner.js` read configuration from `arb-bot/.env.local`. The scanner also loads `contracts/.env` and a `.env` in its working directory. The Hardhat deployment script loads `contracts/.env`.

Create the environment file(s) you need; never commit a real private key or RPC credential.

```dotenv
# Network: anvil-fork, sepolia, or arbitrum
NETWORK=anvil-fork

# Keep enabled while testing. "true" and "1" enable dry-run mode.
DRY_RUN=true

# Required for live wallet operations; use a dedicated test wallet.
PRIVATE_KEY=

# Set the RPC URL for the selected remote network.
SEPOLIA_RPC_URL=
ARBITRUM_RPC_URL=

# Contract address overrides for remote networks.
CONTRACT_ADDRESS=
ARBITRUM_CONTRACT_ADDRESS=

# Scanner settings (defaults shown)
MIN_LIQUIDITY_USD=100000
POOL_PCT=0.01
MIN_LOAN_WETH=0.05
MAX_LOAN_WETH=5
GAS_ESTIMATE_UNITS=450000
PROFIT_SAFETY_MULTIPLIER=2
MIN_PROFIT_FLOOR_WETH=0.001
SLIPPAGE_BUFFER_BPS=100
```

`anvil-fork` uses the local RPC URL and mainnet DEX/token addresses; it therefore needs a correctly configured mainnet fork, not a plain empty local chain. `sepolia` and `arbitrum` use their respective RPC URL variables. The scanner's thresholds and market assumptions are estimates, not guarantees that a transaction will be profitable.

## Run the dashboard and scanner

Start the dashboard from `arb-bot`:

```powershell
cd arb-bot
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). In a second terminal, start the scanner from the same directory so it writes to the same SQLite database:

```powershell
cd arb-bot
node scanner-service/scanner.js
```

The scanner runs continuously and prints structured JSON events to the terminal. It can write scans and executions to SQLite in both dry-run and live modes. The dashboard can run without the scanner, but its scan feed and run history will only show data already in the database.

When `DRY_RUN=true`, the scanner logs that it would execute but sends no transaction. The dashboard's execute flow also simulates steps in dry-run mode. If no usable wallet or provider is configured, the dashboard execution handler can use its local simulated flow; simulated results are not blockchain transactions.

## Dashboard pages and API

| Page | Purpose |
| --- | --- |
| `/` | Dashboard status, selected network, wallet balances, and latest scan |
| `/scanner` | Recent WETH/USDC scan checks and estimated opportunities |
| `/execute` | Submit a flash-loan request and inspect execution steps |
| `/logs` | View recent execution history |

The corresponding Next.js API routes are:

| Method and route | Purpose |
| --- | --- |
| `GET /api/status` | Network, RPC connectivity, wallet balances, and latest scan/run |
| `GET /api/scans?limit=50` | Recent scan records |
| `GET /api/logs?limit=50` | Recent execution records |
| `POST /api/execute` | Submit a loan request; accepts optional JSON `{ "amount": "0.5", "buyOnA": false }` |
| `GET /api/execute/status?txHash=...` | Read the tracked state and steps for a submitted request |

The default loan amount for a manual execution is `0.5` WETH. Execution status is tracked in the running Next.js process; the persisted SQLite run history is separate from that in-memory step status.

## Smart contract development

From the `contracts` directory:

```powershell
cd contracts
npx hardhat compile
npm test
```

`npm test` runs the Solidity tests for `FlashLoanReceiver`, using the mock token, router, and vault contracts. `npm run test:all` runs the broader Hardhat test command.

The deployment script is `contracts/scripts/deploy.js`. It defaults to Sepolia and supports Arbitrum by setting `NETWORK=arbitrum`; configure `PRIVATE_KEY` and the matching RPC URL in `contracts/.env` before running it. After compiling, run it from the `contracts` directory:

```powershell
node scripts/deploy.js
```

The deployment script describes its Sepolia configuration as deployment/plumbing validation, not proof of real two-DEX arbitrage. Its current code passes the configured SushiSwap and Uniswap router addresses as separate constructor arguments. Verify that both addresses have the expected code and usable pair liquidity on the selected network; do not rely on stale script comments or a successful deployment as evidence that arbitrage will work.

## Safety and known limitations

- The scanner only checks one pair (WETH/USDC) across two configured V2-style DEX routers.
- There is no MEV/private-transaction protection. Slippage limits do not prevent front-running or sandwich attacks.
- Pool liquidity, gas costs, quotes, and estimated profit can change before a transaction is included. A successful execution is not guaranteed.
- The contract uses a fixed Balancer V2 Vault address and owner-authorized execution/withdrawal. Confirm that the vault and configured routers are valid on the target network.
- The contract checks that the loan can be repaid, but does not enforce the scanner's estimated-profit threshold. A manual call can therefore revert or be unprofitable.
- Dry-run and simulated dashboard flows do not validate live contract behavior and must not be mistaken for on-chain transactions.
- When live status data is unavailable, the dashboard currently displays placeholder wallet and balance values. Do not treat those fallback figures as on-chain balances.
- Scanner JavaScript does not currently have a dedicated automated unit-test suite; contract tests do not prove live-network profitability or safety.

## Other project notes

- [Project Roadmap.md](./Project%20Roadmap.md) describes implementation status and planned work.
- [UI SPECS.md](./UI%20SPECS.md) documents the dashboard design and data shapes.
- [contracts/README.md](../contracts/README.md) contains the original Hardhat starter documentation.
