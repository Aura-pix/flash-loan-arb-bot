# 0xAurora Smart Contracts

This package contains the Solidity flash-loan receiver, its Hardhat configuration, Solidity tests and mocks, and operational scripts. For the full system overview, see the [repository README](../README.md). For the dashboard and standalone scanner, see the [arb-bot README](../arb-bot/README.md).

## Contents

- `contracts/FlashLoanReceiver.sol` — owner-controlled Balancer V2 flash-loan receiver.
- `contracts/FlashLoanReceiver.t.sol` — Solidity tests for ownership, loan callback validation, slippage settings, withdrawal, and execution flow.
- `mocks/` — mock ERC-20 token, router, and vault used by tests.
- `scripts/deploy.js` — deploys the receiver to Sepolia by default or Arbitrum when selected.
- `scripts/scanner.js` — continuously scans configured WETH/USDC markets and can trigger executions.
- `scripts/simulate.js` and `scripts/test-direction.js` — scripts intended for a local mainnet fork at `http://127.0.0.1:8545`.
- `scripts/withdraw.js` — fork-specific helper containing hard-coded contract/token addresses; inspect and verify them before use.

## Install, compile, and test

Run from this directory:

```powershell
npm install
npx hardhat compile
npm test
```

`npm test` runs `hardhat test solidity`. `npm run test:all` runs `hardhat test`. Tests use the local mocks and do not verify current public-network liquidity, deployed addresses, or trading profitability.

## Deploy

The deployment script defaults to Sepolia. Create `contracts/.env` with the private key of a dedicated test wallet and the RPC URL for the selected network:

```dotenv
NETWORK=sepolia
PRIVATE_KEY=
SEPOLIA_RPC_URL=
# To deploy to Arbitrum instead:
# NETWORK=arbitrum
# ARBITRUM_RPC_URL=
```

After compiling, run:

```powershell
node scripts/deploy.js
```

The script selects Sepolia unless `NETWORK=arbitrum`, checks the wallet's native-token balance, deploys `FlashLoanReceiver` with the network's configured SushiSwap router, Uniswap V2 router, and USDC token, and prints the deployed address. It does not update the dashboard/scanner's configured contract address automatically. Update the matching `CONTRACT_ADDRESS` or `ARBITRUM_CONTRACT_ADDRESS` in `arb-bot/.env.local` yourself, and verify deployment bytecode, router addresses, token addresses, and available liquidity before any interaction.

A successful deployment only proves that the contract was created. The existence of a router address does not establish that both routers support the target pair or have useful liquidity.

## Contract behavior

The contract constructor accepts the two DEX router addresses and the second swap token (`tokenB`). The Balancer V2 Vault address is fixed in the contract. The owner can:

- Set the swap slippage tolerance up to 10%.
- Request a flash loan for a token and amount, selecting the swap direction.
- Withdraw a token balance held by the receiver contract.

On the Balancer callback, the receiver swaps the loan asset to `tokenB` on one router, swaps back on the other, checks that it can repay principal plus the Balancer fee, repays the vault, and emits execution events. The transaction reverts if repayment cannot be made. The contract does not enforce the off-chain scanner's estimated-profit threshold.

## Scanner operation

The scanner reads `NETWORK`, `DRY_RUN`, `PRIVATE_KEY`, RPC URLs, contract address overrides, and optional strategy thresholds from environment variables. It supports `anvil-fork`, `sepolia`, and `arbitrum`; defaults and network addresses are defined in `scripts/scanner.js`.

For a safer initial run, configure an RPC endpoint, keep `DRY_RUN=true`, and start it from this directory:

```powershell
node scripts/scanner.js
```

The scanner polls every 10 seconds, writes structured JSON events to stdout, and attempts to mirror scans/runs into `arb-bot/bot_data.sqlite` when that path and the `better-sqlite3` dependency are available. It may initiate a live transaction only when dry-run mode is disabled and the wallet, RPC, contract, routers, and network configuration are all usable. Validate all of these settings before enabling live transactions.

## Safety notes

- These scripts can send transactions and spend funds when live mode is enabled. Use a dedicated wallet with limited funds and test on a local fork or testnet first.
- Never put private keys or RPC credentials in source control or share them in logs.
- Estimated spreads and gas costs are not guarantees of profit; execution may revert or lose funds.
- The contract has no private transaction/MEV protection. Slippage limits are not a defense against front-running or sandwich attacks.
- Validate the fixed Balancer Vault address and all configured DEX/token addresses on the target network. Do not run fork-specific scripts against a public network without reviewing their hard-coded addresses and behavior.
