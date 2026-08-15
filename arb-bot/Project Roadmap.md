# Flash Loan Arbitrage Bot — Project Documentation

## 1. What this is

An automated system that watches SushiSwap and Uniswap V2 (WETH/USDC) for price
spreads large enough to profit from, and executes a Balancer V2 flash loan to
capture that spread atomically — borrow, swap on the cheap side, swap back on
the expensive side, repay, keep the difference. All in one transaction, so
there's no possibility of being caught holding an unhedged position.

---

## 2. How it works (current architecture)

**Three independent pieces, one system:**

- **`FlashLoanReceiver.sol`** — the on-chain contract. Takes the flash loan
  from Balancer, executes both swaps with slippage protection, checks it can
  repay, repays, emits events for every step.
- **`scanner.js`** — the off-chain brain. Polls both DEXes every 10 seconds,
  sizes a loan dynamically off real pool depth, estimates worst-case profit
  (fees + slippage), and only triggers execution when that estimate clears a
  gas-aware threshold. Logs every scan and every execution as structured JSON.
- **UI (not yet built)** — dashboard, execute panel, logs table, scanner feed.
  Full spec already written separately (`ui-spec.md`) — folder structure,
  design tokens, data shapes, build phases. That plan is unchanged by
  everything below.

**Why the loan size and profit threshold aren't fixed numbers:** loan size is
capped at a % of the shallower pool's liquidity (avoids self-inflicted
slippage), and the profit threshold is gas-price-aware rather than a flat
guess (so it doesn't misfire on a gas spike or leave money on the table when
gas is cheap on an L2).

---

## 3. Status: what's built and proven

Everything below has been tested end-to-end on a forked-mainnet local node,
not just written and assumed correct.

- [x] Contract compiles and deploys cleanly (Hardhat 3)
- [x] Reentrancy protection — correctly scoped to only the outer call, not
      the Balancer callback (an early version over-applied this and broke
      the loan flow; fixed)
- [x] Slippage protection on both swap legs, owner-adjustable tolerance
- [x] No hardcoded token addresses baked into the contract (was a real bug
      in the original version — would've silently broken on any network
      other than mainnet)
- [x] Dynamic loan sizing based on live pool depth, with floor/ceiling
- [x] Gas-aware profit threshold, recalculated every scan
- [x] Off-chain profit estimate accounts for worst-case on-chain slippage,
      not just nominal swap fees (closed a gap that let one trade through
      that then reverted safely)
- [x] **Execution direction bug found and fixed** — the contract's `buyOnA`
      flag and the scanner's `buyOnSushi` flag had opposite meanings, so
      every trade was silently structured to sell low and buy high. This
      would have guaranteed a loss on every single live execution if it had
      gone to Sepolia or mainnet unnoticed.
- [x] Structured JSON logging on every scan/execute event — this is the
      exact shape the UI's logs table will read from later
- [x] **Verified profitable execution** — a genuine flash loan, unsubsidized
      by any leftover test funding, closed at +0.0107 WETH profit on a real
      forked-mainnet spread, confirming the full loan → swap → swap → repay
      cycle and the direction fix both work correctly together

---

## 4. What's left

**Before Sepolia deployment:**

- Redeploy the corrected contract to Sepolia (parked — happens once back on
  the primary dev machine)
- Fill in Sepolia-specific addresses in `scanner.js`'s config block (WETH,
  USDC, router/factory addresses, contract address) — currently placeholders
- Confirm Sepolia actually has usable SushiSwap/Uniswap liquidity for this
  pair; testnet liquidity is often too thin for a meaningful test and this
  hasn't been verified yet

**UI build (full detail in `ui-spec.md`):**

- Phase 1–2: scaffold + static Dashboard
- Phase 3: wire scanner's JSON logs into SQLite
- Phase 4: Logs table + Scanner feed (read-only, easiest real milestone)
- Phase 5: Execute panel with live step breakdown (hardest phase — needs
  either polling or listening to the contract's `StepCompleted` events)
- Phase 6: polish, signature status-ring element

**Not yet decided:**

- Which L2 to eventually move to for real capital — Arbitrum is the current
  lean (deeper liquidity, Balancer's strongest L2 presence) over Base
  (higher raw volume, thinner liquidity), but this is deliberately still
  open until closer to that decision

---

## 5. Known limitations (honest, not hidden)

- **Two-DEX, one-pair only.** Only checks SushiSwap vs Uniswap V2 on
  WETH/USDC. Real arbitrage opportunities exist across many more venues and
  pairs — this is intentionally narrow as a first working system, not the
  ceiling of what it could do.
- **No MEV protection.** A real mainnet deployment broadcasting transactions
  to the public mempool is exposed to front-running/sandwich attacks despite
  the slippage protection. Slippage tolerance limits the _damage_ of a
  sandwich, it doesn't prevent one. Worth a private relay (e.g. Flashbots)
  before any real-money mainnet use.
  - Note: an L2 deployment doesn't automatically remove this risk either —
    MEV exists on L2s too, just with different mechanics.
- **Single-pair static config.** Every address is hand-configured per
  network. Adding a new pair or a new DEX currently means editing config by
  hand, not a UI toggle.
- **No automated tests.** All validation so far has been manual runs against
  a forked node. A real test suite (Hardhat's `test/` folder, currently
  empty) would catch regressions like the direction bug automatically
  instead of relying on manually noticing something's off.

---

## 6. Possible improvements (not committed, just worth having on record)

- Automated test suite covering both the happy path and the failure modes
  already discovered manually (reentrancy, direction, insufficient balance)
- Multi-pair support (WBTC/USDC, etc.) and a config-driven way to add pairs
  without touching scanner logic
- More DEXes per chain (Curve, Balancer pools themselves, on an L2)
- Flashbots/private relay integration before any mainnet capital is at risk
- Circuit breaker: auto-pause the bot after N consecutive reverts, rather
  than relying on you noticing a bad pattern in the logs
- Historical spread analytics — not just "did we execute" but "how often
  was a real opportunity there and what did we miss," useful for tuning
  `POOL_PCT` and the profit threshold with real data instead of guesses

---

## 7. Hosting & deployment

This project has two very different hosting needs, easy to conflate:

- **`scanner.js` needs an always-on process**, not a typical web host. It's
  an infinite polling loop holding a wallet key in memory — incompatible
  with serverless platforms (Vercel, Netlify) that spin functions up
  per-request. It needs a persistent server: a small VPS, or a platform
  with a background-worker service type (Railway, Render, Fly.io).

- **The Next.js UI** would normally be a natural fit for Vercel — except the
  plan relies on SQLite as a file shared between the scanner and the UI's
  API routes. Vercel's filesystem is ephemeral and not shared across hosts,
  so Vercel specifically is the wrong fit here — not because of Next.js,
  but because of that SQLite coupling.

**Simplest real setup for a solo project:** don't split hosts. Run
`scanner.js` and the Next.js app (in persistent mode, not serverless
functions) together on one machine — either a single small VPS (~$5–6/mo,
run both processes with `pm2`) or a platform like Railway/Render supporting
multiple persistent services plus a mounted volume for the SQLite file
within one project. Same filesystem, no cross-host file-sharing problem.

**Security note that matters once this is real, not local:** whatever host
runs `scanner.js` holds `PRIVATE_KEY` in its environment. That wallet should
be a dedicated hot wallet funded only with what the bot needs to operate —
never a main wallet — regardless of how secure the host claims to be.

This isn't an urgent decision — relevant once Sepolia (or later, an L2) is
actually live and something needs to run continuously rather than on a
local machine.

---

## 8. Long-term aim

Right now this is a single-pair, single-chain-target learning project built
to be understood end-to-end, not a black box. The near-term path is: Sepolia
validation → pick an L2 (Arbitrum-leaning) → real (small) capital → UI live
on top of real data. Anything past that — more pairs, more chains, more
sophistication — is deliberately not planned yet, since the priority has
been getting one clean, correctly-reasoned system working before expanding
scope.
