# Flash Loan Arbitrage Bot — Project Analysis

## Overview

A **Balancer V2 flash loan arbitrage bot** that exploits WETH/USDC price discrepancies between **SushiSwap** and **Uniswap V2**. The system is split into two workspaces: a **Hardhat smart contract project** and a **Next.js dashboard UI** (currently scaffolded but not built out).

---

## Architecture (3 Pieces)

```mermaid
graph LR
    subgraph "On-Chain (Solidity)"
        A["FlashLoanReceiver.sol"]
    end
    subgraph "Off-Chain (Node.js)"
        B["scanner.js — 10s polling loop"]
        C["simulate.js — local fork test"]
        D["test-direction.js — direction fix verifier"]
        E["withdraw.js — sweep leftover WETH"]
    end
    subgraph "UI (Next.js — scaffolded only)"
        F["arb-bot/ — create-next-app boilerplate"]
    end

    B -- "calls requestFlashLoan()" --> A
    A -- "flash loan from" --> G["Balancer Vault"]
    A -- "swap 1" --> H["SushiSwap Router"]
    A -- "swap 2" --> I["UniswapV2 Router"]
    F -. "planned: reads scanner logs" .-> B
```

---

## Component Breakdown

### 1. Smart Contract — [`FlashLoanReceiver.sol`](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/contracts/contracts/FlashLoanReceiver.sol)

| Feature | Detail |
|---|---|
| **Solidity version** | `^0.8.10` (compiled with `0.8.28` via Hardhat 3) |
| **Flash loan source** | Balancer V2 Vault (`0xBA12222...`) — fee-free flash loans |
| **Trade pair** | WETH ↔ `tokenB` (USDC, set at deploy time — not hardcoded) |
| **DEXes** | `dexA` and `dexB` (SushiSwap + UniswapV2 routers, set at deploy) |
| **Direction flag** | `buyOnA` — when `true`, sells on dexA first (dexA is expensive), buys back on dexB (dexB is cheap) |
| **Slippage protection** | On-chain `getAmountsOut()` quotes with `slippageToleranceBps` (default 1%, max 10%, owner-adjustable) |
| **Reentrancy guard** | Custom `nonReentrant` on `requestFlashLoan()` only — correctly NOT on `receiveFlashLoan()` (Balancer callback) |
| **Events** | `LoanExecuted`, `StepCompleted` ×2, `ArbitrageResult`, `Withdrawn` |
| **Withdraw** | Owner can sweep any ERC-20 token from the contract |

**Execution flow:**
1. Owner calls `requestFlashLoan(WETH, amount, buyOnA)`
2. Balancer calls back `receiveFlashLoan()` with the borrowed WETH
3. **Swap 1:** WETH → USDC on the expensive DEX (sell high)
4. **Swap 2:** USDC → WETH on the cheap DEX (buy low)
5. Repay Balancer the original loan (+ 0 fee for Balancer V2)
6. Keep the WETH difference as profit

---

### 2. Scanner — [`scanner.js`](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/contracts/scripts/scanner.js)

The off-chain brain. Runs as a long-lived Node.js process polling every 10 seconds.

**Key logic:**

| Feature | Detail |
|---|---|
| **Network support** | `anvil-fork` (default, local) and `sepolia` (placeholder addresses, unfilled) |
| **Pool depth check** | Fetches reserves from both factories, skips if either pool has < $100k USDC liquidity |
| **Dynamic loan sizing** | `POOL_PCT` (1%) of the shallower pool's WETH reserve, clamped to [0.05, 5] WETH |
| **Profit estimation** | Accounts for 0.3% DEX fee **AND** full slippage tolerance per swap — deliberately pessimistic |
| **Gas-aware threshold** | `gasCost × safetyMultiplier` vs `MIN_PROFIT_FLOOR_WETH` — recalculated every scan |
| **Direction fix** | `buyOnA = !buyOnSushi` — inverts the scanner's "buy on Sushi" signal to match the contract's "sell on dexA first" semantics |
| **Auto-withdraw** | After a successful arb, immediately calls `contract.withdraw(WETH)` to sweep profit to wallet |
| **Structured logging** | Every event emitted as JSON (`bot_started`, `scan_checked`, `opportunity_found`, `execute_start`, `execute_success`, etc.) — designed for the UI to consume later |

**Configuration (all env-tunable):**

| Variable | Default | Purpose |
|---|---|---|
| `POOL_PCT` | 0.01 (1%) | Fraction of shallower pool's WETH to borrow |
| `MIN_LOAN_WETH` | 0.05 | Loan size floor |
| `MAX_LOAN_WETH` | 5 | Loan size ceiling |
| `GAS_ESTIMATE_UNITS` | 450,000 | Gas units for threshold calc |
| `PROFIT_SAFETY_MULTIPLIER` | 2× | How much above gas cost profit must clear |
| `MIN_PROFIT_FLOOR_WETH` | 0.001 | Absolute minimum profit threshold |
| `SLIPPAGE_BUFFER_BPS` | 100 (1%) | Must match contract's `slippageToleranceBps` |

---

### 3. Test Scripts

| Script | Purpose |
|---|---|
| [`simulate.js`](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/contracts/scripts/simulate.js) | Full end-to-end test: deploys fresh contract on fork, funds with 0.1 WETH, executes a 1 WETH flash loan with `buyOnA=false`, measures profit |
| [`test-direction.js`](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/contracts/scripts/test-direction.js) | One-off verification of the direction fix: checks real prices, picks correct direction, executes 0.629 WETH loan, confirms profit (not loss) |
| [`withdraw.js`](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/contracts/scripts/withdraw.js) | Sweeps leftover WETH from a specific contract address — used between test runs to avoid subsidized results |

---

### 4. UI — [`arb-bot/`](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/arb-bot)

**Current state: Create Next App boilerplate — no custom UI built yet.**

- Next.js 16.3.1 with App Router, React 19, TypeScript, Tailwind CSS v4
- [page.tsx](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/arb-bot/app/page.tsx) is the default "Get started" template
- [globals.css](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/arb-bot/app/globals.css) has basic light/dark theme variables

**Planned (per [UI SPECS.md](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/arb-bot/UI%20SPECS.md)):**

| Page | Purpose |
|---|---|
| `/` (Dashboard) | Bot status, wallet balance, network selector, live status ring |
| `/execute` | Trigger `requestFlashLoan`, live step-by-step breakdown via `StepCompleted` events |
| `/logs` | Historical run table from SQLite |
| `/scanner` | Live scanner feed from SQLite |
| `API routes` | `/api/status`, `/api/execute`, `/api/logs`, `/api/scans` |

**Design language:** Dense instrument panel aesthetic — deep slate (`#12151C`), copper accent (`#C08A3E`), Space Grotesk + Inter + JetBrains Mono. Signature element: live status ring.

---

## Project Status

| Area | Status |
|---|---|
| Contract logic | ✅ Complete, tested, direction bug fixed |
| Scanner (off-chain) | ✅ Complete, tested on forked mainnet |
| Forked mainnet validation | ✅ Verified profitable (+0.0107 WETH) |
| Sepolia deployment | ⏸️ Parked — addresses unfilled, needs primary dev machine |
| Next.js UI | 🟡 Scaffolded only — boilerplate, no custom pages |
| SQLite integration | ❌ Not started |
| Automated tests | ❌ None — all validation manual |
| MEV protection | ❌ Not implemented (acknowledged risk) |

---

## Key Design Decisions Worth Noting

1. **No hardcoded token addresses in the contract** — `tokenB`, `dexA`, `dexB` are all constructor args, making it deployable on any EVM chain
2. **Balancer V2 for flash loans** — 0% fee, unlike Aave's 0.09%
3. **The direction bug** — `buyOnA` (contract) ≠ `buyOnSushi` (scanner). The fix: `buyOnA = !buyOnSushi`. Without this, every trade would have sold low and bought high
4. **Pessimistic profit estimation** — accounts for both DEX fees AND full slippage tolerance. This means fewer false triggers but safer executions
5. **Auto-withdraw after profit** — profits are immediately swept to the wallet, not left sitting in the contract

> [!WARNING]
> The `.env` file contains a **private key** and an **Alchemy API key** in the repo. The private key (`0xac0974...`) is Hardhat's default test account (account #0), so it's not a real key — but the Alchemy key is real and should not be committed.

---

## What Would You Like to Work On?

The main open workstreams are:
1. **Build out the UI** — following the spec in [UI SPECS.md](file:///c:/Users/HOME%20PC/Desktop/Arbitrage%20bot/arb-bot/UI%20SPECS.md)
2. **Sepolia deployment** — fill in testnet addresses, redeploy contract
3. **Automated test suite** — Hardhat tests for the contract
4. **Multi-pair / multi-DEX expansion**
5. **MEV protection** (Flashbots integration)

Let me know what you'd like to tackle.
