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

The deployment script requires an explicit `NETWORK`. Create `contracts/.env` with the private key of a dedicated wallet and the RPC URL for the selected network:

```dotenv
NETWORK=base
PRIVATE_KEY=
BASE_RPC_URL=
ARBITRUM_RPC_URL=
SEPOLIA_RPC_URL=
# Required for a mainnet deployment:
CONFIRM_DEPLOY=1
# Optional V2 venue overrides (venue id or router address):
DEX_A=
DEX_B=
```

After compiling, run:

```powershell
node scripts/deploy.js
```

The script verifies the RPC chain ID, checks that every configured token/router/vault address has bytecode, prints the pair reserves for both V2 venues, and refuses to deploy to Base or Arbitrum unless `CONFIRM_DEPLOY=1` is set. It deploys `FlashLoanReceiver` with the selected SushiSwap/Uniswap-V2-style routers and quote token, then prints the deployed address and the environment variable to set (`BASE_CONTRACT_ADDRESS` or `ARBITRUM_CONTRACT_ADDRESS`). It does not update the dashboard/scanner configuration automatically. Verify deployment bytecode, router addresses, token addresses, and available liquidity before any interaction.

The current contract is V2/V2 only. Base does not have a second deep V2 WETH/USDC venue, so the Base V2/V3 receiver is the next phase; do not deploy the V2/V2 contract to Base expecting it to trade.

A successful deployment only proves that the contract was created. The existence of a router address does not establish that both routers support the target pair or have useful liquidity.

## Contract behavior

The contract constructor accepts the two DEX router addresses and the second swap token (`tokenB`). The Balancer V2 Vault address is fixed in the contract. The owner can:

- Set the swap slippage tolerance up to 10%.
- Request a flash loan for a token and amount, selecting the swap direction.
- Withdraw a token balance held by the receiver contract.

On the Balancer callback, the receiver swaps the loan asset to `tokenB` on one router, swaps back on the other, checks that it can repay principal plus the Balancer fee without consuming any pre-existing balance, enforces the caller-supplied `minProfit`, repays the vault, and emits execution events. `requestFlashLoan(token, amount, buyOnA, minProfit)` reverts with `Below min profit` if the realized profit is below the requested floor. The transaction reverts if repayment cannot be made.

## Scanner operation

`contracts/scripts/scanner.js` is a deprecated compatibility wrapper around the canonical scanner at `../arb-bot/scanner-service/scanner.js`. Prefer running the scanner from `arb-bot`:

```powershell
cd ..\arb-bot
node scanner-service/scanner.js
```

The scanner reads `NETWORK`, `DRY_RUN`, `PRIVATE_KEY`, RPC URLs, contract address overrides, `QUOTE_TOKEN`, and optional strategy thresholds from the environment. It supports `anvil-fork`, `sepolia`, `arbitrum`, and `base`. The network, token, and venue addresses live in `arb-bot/config/networks.js`.

## Safety notes

- These scripts can send transactions and spend funds when live mode is enabled. Use a dedicated wallet with limited funds and test on a local fork or testnet first.
- Never put private keys or RPC credentials in source control or share them in logs.
- Estimated spreads and gas costs are not guarantees of profit; execution may revert or lose funds.
- The contract has no private transaction/MEV protection. Slippage limits are not a defense against front-running or sandwich attacks.
- Validate the fixed Balancer Vault address and all configured DEX/token addresses on the target network. Do not run fork-specific scripts against a public network without reviewing their hard-coded addresses and behavior.
