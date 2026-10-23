# TanStack Start handoff

The migration is complete in `/Users/ryan/dev/ryvu`. Start owns the file routes in `src/routes/` and the named server functions in `src/*.functions.ts`. Vite runs development and builds both sides. The handwritten router, generic API transport, proxy, and custom dev/build supervisors are removed. A small production launcher owns loopback binding and awaited shutdown.

- `pnpm dev` serves development at http://127.0.0.1:5173.
- `pnpm build` builds and type-checks the app.
- `pnpm start` serves the production build at http://127.0.0.1:4317.

Existing edits were included in the preserved baseline and carried through each hash-checked integration. User data was copied for verification. The parent branch remains `main` at `7bf57c5`, with no staged changes. Migration changes remain uncommitted in this checkout. Its source tree exactly matches final commit `0423dbeec7ee4d4c48807270d3de2ad9bd744065`. [Source and final verification receipt](/var/folders/f2/j708znxx2_l5_q4mjffcb5t40000gn/T/ryvu-tanstack-start-6of063zt/final-receipt.json).

Frozen installation, typecheck and build pass. Independent final verification passed 17 browser runs, 305 checks, and zero page or console errors. It covered the six production feature journeys, navigation, settings and local drafts, security in both modes, hot reload, actual polling and Cancel, four shutdown paths, and scrolling after hot reload. Five fresh production journeys also passed in the parent checkout. Every analysis used a stand-in Codex; GitHub calls were reads. [Full independent verdict and evidence](/var/folders/f2/j708znxx2_l5_q4mjffcb5t40000gn/T/ryvu-tanstack-start-6of063zt/verify-final/verdict.md).

The polling loss was deterministic. Only the React context errors varied with update ordering. Both are fixed. The final composer checks preserve the same textarea, typed text, and drawn line across edits to both server-function modules. Stable contexts and a stable error-boundary class prevent remounting.

Reviewed by Claude Opus 5.5 and GPT-6.1 Sol. Both final reviews found no critical or warning issues. The remaining test-only nit is fixture selection: a largest PR with no drawn added line can time out before the composer checks. Today's real fixture was eligible. [Review A](/var/folders/f2/j708znxx2_l5_q4mjffcb5t40000gn/T/ryvu-tanstack-start-6of063zt/review-final-a.md), [review B](/var/folders/f2/j708znxx2_l5_q4mjffcb5t40000gn/T/ryvu-tanstack-start-6of063zt/review-final-b.md).

Coverage limits and retained observations:

- The error-boundary fallback was not forced. Composer HMR coverage used one inline composer; indicator mode and the draft edit box were not exercised across an edit.
- Typing scrolls diff code sideways on both the baseline and final code. This predates the migration fix.
- A repeated identical shutdown signal force-quits during the drain. Ordinary signal cleanup passed.
- The final verifier's first port-bind cleanup observation failed, then passed without further process termination. Its cause remains unproven. No browser journey needed a retry in final verification. An earlier persistence timeout and its successful unchanged retry remain in the historical evidence.

Four unused worktrees and their private branches were removed after archiving evidence. Three clean worktrees remain because live tool runtimes retain their working directories. All app servers and analysis stand-ins are stopped. The full commit chain is reachable through `refs/codex/ryvu-tanstack-start-20261023`. [Cleanup receipt and archive mapping](/var/folders/f2/j708znxx2_l5_q4mjffcb5t40000gn/T/ryvu-tanstack-start-6of063zt/worktree-cleanup.json).

Fix Root Causes led to stabilizing both contexts and the error boundary instead of caching unsaved text. Migrate Callers Then Delete Legacy APIs removed the old transport in the same migration. Prove It Works drove checks of the actual textarea, drawn code, child PIDs, ports and SQLite cleanup.

[Decision trail](/Users/ryan/dev/ryvu/.audit/tanstack-start.tsv). [Dispatch ledger](/Users/ryan/dev/ryvu/.audit/tanstack-start-dispatch.md).
