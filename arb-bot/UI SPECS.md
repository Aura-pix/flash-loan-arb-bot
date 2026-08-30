# 0xAurora — UI Spec

## 1. Design direction

**Concept: instrument panel, not a marketing page.** This is a tool you watch while money moves — the job is legibility under stress, not first impressions. Think avionics/trading-terminal precision rather than a landing page.

### Color tokens

| Token       | Hex       | Use                                          |
| ----------- | --------- | -------------------------------------------- |
| `--bg`      | `#12151C` | app background — deep slate, not pure black  |
| `--panel`   | `#1A1F2B` | card/panel surfaces                          |
| `--line`    | `#2A3040` | hairline borders, dividers                   |
| `--ink`     | `#E4E7EC` | primary text                                 |
| `--ink-dim` | `#8A93A6` | secondary text, labels                       |
| `--accent`  | `#C08A3E` | copper — live/active states, primary actions |
| `--good`    | `#4CAF7D` | success, profit                              |
| `--bad`     | `#D9584C` | revert, loss, error                          |

Copper instead of the terracotta/neon-green defaults — reads as "instrument brass," not "AI demo."

### Typography

- **Display / headers:** `Space Grotesk` — has just enough personality without being decorative
- **Body / UI chrome:** `Inter` — gets out of the way
- **Numbers, addresses, tx hashes, gas figures:** `JetBrains Mono` — every dashboard needs one column font; this is where it matters most, since misread digits here are a costly typo

### Layout concept

Dense grid, not generous whitespace. Panels tile edge-to-edge with hairline dividers (`--line`), not drop shadows or rounded cards — this isn't a SaaS marketing site. Status is always color + text, never color alone (accessibility, and you'll be glancing at this half-asleep at 2am watching a run).

### Signature element

A **live status ring** in the dashboard header — a thin circular gauge that fills as the scanner completes each 10s cycle, color-shifts on opportunity-found, and pulses on execute. One memorable, functional element; everything else stays quiet.

### Branding placement

Where "0xAurora" and the logo mark actually show up in the app — this needs
to land in the code, not just live in the docs:

- **`app/layout.tsx` header** — logo mark (small, ~24–28px) + "0xAurora"
  wordmark, top-left of the nav bar, next to the live status ring. This is
  the one placement that matters most since it's visible on every page.
- **Browser tab** — set via `layout.tsx`'s exported `metadata` object:
  `title: "0xAurora"` (or `"0xAurora — Dashboard"` per-page if you want
  page-specific tab titles later).
- **`app/favicon.ico`** — replace Next.js's default favicon with a small
  square/circular export of the logo mark once Gemini generates it.
- **Loading/empty states** — optional, but the logo mark works well as a
  subtle watermark on empty states (e.g. Logs table before any runs exist)
  rather than a generic spinner — reinforces the brand in otherwise blank
  moments without adding clutter to data-dense screens.

No footer branding — the header placement is enough; repeating it below is
just noise on an instrument-panel-style layout.

---

## 2. Folder structure (Next.js App Router)

Since Next.js is new to you — the App Router uses **folders as routes**. A folder named `execute/` with a `page.tsx` inside becomes the `/execute` page. `layout.tsx` wraps everything under it (nav, shared chrome). `api/` folders become backend endpoints — this is your Express-replacement.

```
arb-bot-ui/
├── app/
│   ├── layout.tsx              # root shell: fonts, nav, status ring
│   ├── page.tsx                # Dashboard (bot status, wallet balance, network selector)
│   ├── globals.css             # design tokens as CSS variables
│   │
│   ├── execute/
│   │   └── page.tsx            # Execute panel — trigger + live step breakdown
│   │
│   ├── logs/
│   │   └── page.tsx            # Logs table — historical runs
│   │
│   ├── scanner/
│   │   └── page.tsx            # Scanner feed — recent opportunity checks
│   │
│   └── api/
│       ├── status/route.ts     # GET  — bot state, wallet balance, network
│       ├── execute/route.ts    # POST — trigger requestFlashLoan, stream steps
│       ├── logs/route.ts       # GET  — paginated run history from DB
│       └── scans/route.ts      # GET  — recent scan_checked events from DB
│
├── lib/
│   ├── contract.ts             # ethers Contract instance + ABI (shared)
│   ├── db.ts                   # SQLite connection (better-sqlite3 or Prisma)
│   └── events.ts               # parses scanner.js JSON log lines into DB rows
│
├── components/
│   ├── StatusRing.tsx          # the signature element
│   ├── StepBreakdown.tsx       # execute panel's live per-step display
│   ├── LogsTable.tsx
│   └── ScannerFeed.tsx
│
├── scanner-service/            # scanner.js lives here (or as a separate
│   └── scanner.js              # long-running process) — writes to the same
│                                # SQLite file lib/db.ts reads from
│
├── .env.local                  # PRIVATE_KEY, RPC URLs — never committed
└── package.json
```

**Why this shape:** your existing `scanner.js` doesn't need to become a Next.js API route — it's a long-running loop, not a request/response endpoint. Keep it as its own process writing structured JSON logs (which you already built) into SQLite. The Next.js API routes just _read_ that same SQLite file. `POST /api/execute` is the one route that actually calls the contract directly (one-off trigger, not a loop).

---

## 3. Data shapes (what the UI actually renders)

These map directly to the events already built into the contract and `scanner.js` — the UI's job is just to display them, not invent new shapes.

**Scan row** (from `scan_checked` log lines):

```ts
{
  (ts,
    sushiPrice,
    uniPrice,
    spreadPct,
    loanSizeWeth,
    estimatedProfitWeth,
    thresholdWeth,
    gasPriceGwei);
}
```

**Run row** (from `execute_start` → `execute_success`/`execute_reverted`/`execute_error`):

```ts
{ ts, network, txHash, status: "success" | "reverted" | "error", gasUsed, elapsedMs, loanSizeWeth, profitWeth? }
```

**Live step breakdown** (Execute panel, sourced from contract events `LoanExecuted` → `StepCompleted` ×2 → `ArbitrageResult`):

```ts
{
  step: ("loan_taken" | "swap_1" | "swap_2" | "repaid",
    gasUsedCumulative,
    timestamp);
}
```

---

## 4. Build roadmap

Rough order — each phase is small enough to finish with a tutorial + a few questions to me, not a multi-week grind.

1. **Scaffold** — `create-next-app`, TypeScript, Tailwind. Set up `globals.css` with the token table above as CSS variables. Get `layout.tsx` + empty Dashboard page rendering.
2. **Static Dashboard** — bot status card, wallet balance (read-only ethers call), network selector UI (Sepolia only for now). No live data yet — hardcode, get the layout right.
3. **SQLite + log ingestion** — point `scanner.js`'s JSON log lines at a SQLite file (append rows on each `log()` call, or a tiny separate script that tails stdout). This unblocks Logs and Scanner Feed.
4. **Logs table + Scanner feed** — `GET /api/logs`, `GET /api/scans`, render as tables. This is the easiest "feels real" milestone — do this before Execute panel.
5. **Execute panel** — the hard one. `POST /api/execute` calls `requestFlashLoan`, then either polls the tx receipt or (better, once comfortable) listens for the contract's `StepCompleted` events and streams them to the client via a simple polling interval or SSE.
6. **Status ring + polish** — the signature element last, once real data is flowing through everything it's supposed to visualize.

Start with 1–2 and come back anytime you hit a Next.js concept the tutorials don't make click — happy to explain App Router routing, server vs client components, or API routes in plain terms as you go.
