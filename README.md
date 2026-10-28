# Flash-Loan Arbitrage Bot

This experimental arbitrage system combines a Node.js scanner, Next.js dashboard, and Solidity flash-loan receiver. It compares WETH/USDC prices on configured SushiSwap and Uniswap V2 markets and can request a Balancer V2 flash loan for an atomic two-swap trade. Profit is not guaranteed.

## How it works

```text
SushiSwap + Uniswap V2 pools (WETH/USDC)
                 |
                 v
  arb-bot/scanner-service/scanner.js
  reads reserves and router quotes every 10 seconds
                 |
       estimates profit vs. threshold
          /                  \
 below threshold          above threshold
   keep scanning       DRY_RUN? -- yes --> log only
                           |
                           no
                           v
                 Balancer V2 flash loan
                           |
                           v
  FlashLoanReceiver: swap on one DEX, swap back on the other,
  repay principal + fee, then report any remaining profit
                           |
                           v
        SQLite history <---+---> Next.js dashboard
```

The scanner sizes a candidate loan from the shallower pool's WETH reserve within configured limits, then estimates fees, slippage, and a gas-based profit threshold. SQLite stores scan/run history for the dashboard's status, scanner, logs, and manual execution pages. Manual execution bypasses the scanner's threshold; dry-run results are simulations, not transactions.

## Contracts and configured addresses

`contracts/contracts/FlashLoanReceiver.sol` implements the owner-controlled receiver. Its constructor takes two DEX routers and the second swap token; its Balancer V2 Vault is fixed at `0xBA12222222228d8Ba445958a75a0704d566BF2C8`. Deployment prints an address but does not update bot configuration.

The bot source includes these receiver address defaults:

| Network | Address in scanner configuration | How to verify |
| --- | --- | --- |
| Local `anvil-fork` | `0x1C33Db5FC563ac9732C5352c37B73d95b7015E6f` | Check code on your local fork with `cast code <address> --rpc-url http://127.0.0.1:8545`. |
| Sepolia | `0x893144cA871B2f21399f56B385542273aBaae04D` | Look up the address on [Sepolia Etherscan](https://sepolia.etherscan.io/). |
| Arbitrum | None; set `ARBITRUM_CONTRACT_ADDRESS` for a deployment you control | Look up your deployed address on [Arbiscan](https://arbiscan.io/). |

These source defaults do not confirm a live deployment or correct configuration; verify code, owner, routers, token, and network. The deploy script defaults to Sepolia for plumbing validation, not proof of arbitrage. Markets are WETH/USDC with network-specific addresses in scanner source.

## Prerequisites

- Node.js 20.9 or newer and npm.
- An RPC endpoint for Sepolia or Arbitrum, or a local Anvil node forked from Ethereum mainnet at `http://127.0.0.1:8545` (the default network).
- For live transactions/deployment: a dedicated wallet and native currency for gas. Dry-run/dashboard development needs no key.
- For contract deployment/testing: the separate dependencies installed from `contracts/`.

## Installation

Clone the repository and install each package from its own directory:

```powershell
git clone https://github.com/Aura-pix/flash-loan-arb-bot.git
cd flash-loan-arb-bot\arb-bot
npm ci
cd ..\contracts
npm ci
```

## How to start a local Anvil fork

On Windows, use Git Bash or WSL (not PowerShell/Command Prompt) to install Foundry and Anvil:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

In a new terminal, replace `<your RPC>` with a mainnet RPC URL:

```bash
anvil --fork-url <your RPC> --port 8545
```

Keep Anvil running with `NETWORK=anvil-fork`. Its generated accounts/keys are public; never use them for real funds. See the [Foundry installation guide](https://getfoundry.sh/introduction/installation/) and [Anvil docs](https://getfoundry.sh/anvil/).

## Environment variables

Create `arb-bot/.env.local`, loaded by the dashboard and standalone scanner. Keep secrets out of source control; this example contains no credentials:

```dotenv
NETWORK=anvil-fork
DRY_RUN=true
PRIVATE_KEY=
SEPOLIA_RPC_URL=
ARBITRUM_RPC_URL=
CONTRACT_ADDRESS=
ARBITRUM_CONTRACT_ADDRESS=

MIN_LIQUIDITY_USD=100000
POOL_PCT=0.01
MIN_LOAN_WETH=0.05
MAX_LOAN_WETH=5
GAS_ESTIMATE_UNITS=450000
PROFIT_SAFETY_MULTIPLIER=2
MIN_PROFIT_FLOOR_WETH=0.001
SLIPPAGE_BUFFER_BPS=100
```

`NETWORK` accepts `anvil-fork`, `sepolia`, or `arbitrum`; its local RPC is fixed in code. For testnets, set the matching RPC URL. `PRIVATE_KEY` is for wallet operations. `CONTRACT_ADDRESS` overrides Sepolia's default; Arbitrum requires `ARBITRUM_CONTRACT_ADDRESS`. Other variables tune liquidity, loan sizing, gas/profit thresholds, and slippage (shown defaults). Keep `DRY_RUN=true` until live settings are verified.

For deployment, create `contracts/.env` with `NETWORK`, `PRIVATE_KEY`, and the matching RPC URL. Use a funded development wallet; never commit this file. Set the deployed address in the matching bot variable.

## Run

Start the dashboard:

```powershell
cd arb-bot
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To populate the scanner feed, open a second terminal and start the scanner from the same directory:

```powershell
cd arb-bot
node scanner-service/scanner.js
```

The scanner needs a reachable RPC and working router/factory contracts even in dry-run mode; it still reads market data. It writes history to `arb-bot/bot_data.sqlite`, which the dashboard reads from its working directory. The dashboard can start without network access, but scanning cannot.

Compile and run the Solidity tests separately:

```powershell
cd contracts
npx hardhat compile
npm test
```

To deploy, configure `contracts/.env`, run `node scripts/deploy.js` from `contracts`, then set the printed address in the bot environment. Verify network routers/tokens; deployment alone does not prove liquidity or profitability.

## Troubleshooting

- **RPC not reachable:** For `anvil-fork`, confirm Anvil is still running on port 8545 and that your fork RPC is valid. For Sepolia or Arbitrum, check the selected `NETWORK` and matching RPC URL.
- **`CONTRACT_ADDRESS` not set:** After deployment, set `CONTRACT_ADDRESS` in `arb-bot/.env.local` for Sepolia or `ARBITRUM_CONTRACT_ADDRESS` for Arbitrum, then restart the scanner/dashboard. Arbitrum has no address default in the scanner.
- **SQLite file locked:** Stop duplicate scanner/dashboard processes that may be writing to `arb-bot/bot_data.sqlite`, allow any active write to finish, and restart one scanner. Do not delete the database if you need its history.

## Risks and disclaimer

Live execution can lose funds: prices, liquidity, fees, and gas change, and trades can revert. The contract checks loan repayment but not the scanner's profit threshold. There is no private transaction/MEV protection; slippage limits do not prevent front-running or sandwich attacks. Test on a fork/testnet with `DRY_RUN=true`, verify configuration, and risk only funds you can afford to lose. This is not financial or investment advice.
