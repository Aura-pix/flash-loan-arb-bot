// Deprecated compatibility wrapper.
//
// The canonical scanner now lives in arb-bot/scanner-service/scanner.js.
// This file remains so existing runbooks keep working, but it no longer
// contains a second copy of the strategy logic.
//
// Prefer:
//   cd arb-bot
//   node scanner-service/scanner.js

console.warn(
  "contracts/scripts/scanner.js is deprecated; use arb-bot/scanner-service/scanner.js"
);

await import("../../arb-bot/scanner-service/scanner.js");
