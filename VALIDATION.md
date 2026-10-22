# Validation — 7 October 2026

- Production TypeScript/Vite build passed.
- Dependencies audited with zero reported vulnerabilities after removing the temporary shadcn CLI.
- Actual shadcn base-nova components were generated and retained in `src/web/components/ui`.
- Diffs successfully parsed all three fixture patches in a Node smoke check.
- CLI discovery confirmed existing ChatGPT authentication and `gpt-6-luna` availability. GitHub account and Ryvn PR metadata were readable earlier in the session.
- Selected target: `ryvn-technologies/ryvn#9229`; observed base `bf5e135ce648dc7f885ffd3b39ab39f91bd38cfb`, head `2405d6b70f5b738bd5878167d920b43609748da3`. These are observations, not a generated-guide snapshot.
- Local server running at `http://127.0.0.1:4317`.
- The initial authorization review block was resolved by the supplied transcript evidence. The identical retry was approved. Ryvn PR #9229 exceeded the 120,000-character input limit and was rejected before model analysis. The user-selected fallback `ryandotelliott/t3code#5` generated successfully through IAB using existing ChatGPT-authenticated Codex and `gpt-6-luna` (high reasoning).
- Real guide: 25 changed files, 4 chapters, 26 exact changed-hunk references, no missing patches or omissions. All references and file coverage passed `validateGuide`. Base `c769d804559bd85b2f1fe53b608107b085162282`; head `59d3eed8aeaf52a20f535cb6bf481d082dea9817`.
- Verified real guide navigation, unified/split diff display, local progress, SHA-specific cache reuse and cancellation of an active PR refresh in IAB. Model generation was completed once; subsequent successful refreshes used cache. No external review/comment/merge writes were made.
- Server restarted as a detached localhost process; PID is recorded privately in `.data/server.pid`, with startup log in `.data/server.log` (server code does not log raw CLI responses).
- Personal Chrome was stopped when requested. The supported Codex/ChatGPT in-app browser (IAB, browser ID 3) successfully opened localhost. Verified fictional example loading, unified/split diff rendering, chapter navigation, Trees file navigation, evidence selection, marking a chapter read, progress persistence after reload, and invalid-URL errors. Browser console showed no warnings/errors during the check. Screenshot: `evidence/example-split.jpg`.
- Native Linear accessibility inspection confirmed the chapter Guide structure; native screenshots were blank, so none are supplied as evidence.

**Final offline tests: 11 passed, 0 failed.** Both server and browser TypeScript checks pass. These tests cover cancellation and stale-job behavior using injected adapters and real harmless Node subprocesses; UI refresh cancellation is verified against the real GitHub read path. Cancellation of a live Codex inference was not separately exercised; subprocess-group termination is covered by the offline tests.

Verified real-guide screenshot saved to ChatGPT Library as `t3code-guide.jpg`. Library ID: `libfile_691865f5f8b08191b04dede90d6bc25f`; File ID: `file_00000000ef2481f7a321ae813ca680d9`. Local Library identity and version metadata were persisted successfully. Detailed run evidence is in `evidence/validation.json`.

## Minimal reference layout · 2026-10-07

Viewed the actual pixels of Ryan's local reference at `~/Documents/screenshots/CleanShot 2026-10-07 at 4.05.02 PM@2x.png`. Replaced the dark shell with a light page, compact PR title and metadata, vertically stacked sections, a 25% explanation/file-link column and 75% diff column, collapsed file rows, and expandable light diffs. Refresh, outline navigation, Trees, and unified/split controls are available through the top-right review-controls button. Existing chapter progress is preserved; per-file local progress now collapses reviewed diffs. Review questions remain available in a compact disclosure.

Build and both TypeScript checks passed. All 11 existing tests passed with the loopback HTTP test run under approved permissions. IAB-only QA on the cached t3code PR #5 verified: four sections and 25 file rows, collapse/expand, file and chapter checkboxes, chapter-to-file progress synchronization, progress persistence after reload, Trees navigation, split/unified switching, evidence highlighting, and no page-level horizontal overflow. No new model inference or GitHub writes occurred. Controls were closed for the final screenshot; one short evidence diff was expanded.

Final screenshot: `evidence/minimal-review.jpg`, 173680 bytes, saved to Library as `libfile_eee9dc1d96ec8191b2ac7da716a84a94` (`file_00000000fa1881fd80663c687e7e29b0`), version 0; local Library identity persisted. The earlier attachment materialization blocker is resolved by the explicitly authorized local reference file.

## Section-bound sticky summaries · 2026-10-07

Each desktop chapter summary uses `position: sticky`, `align-self: start`, and a 16px top inset within its own chapter grid. The PR header remains in normal document flow; no fixed header obscures the summary. A configurable summary inset also drives the viewport height cap. Tall summaries have a focusable, internally scrollable region; the single-column breakpoint disables sticky positioning and the height cap. Collapsed file lists leave the summary contained in their section.

Build and both TypeScript checks passed; all 11 existing tests passed. Actual IAB scrolling on the cached t3code PR #5 checked two boundaries (chapters 1→2 and 2→3). During the expanded second-section diff, its section top was -607.5px and summary top was 16px; near the boundary its summary bottom matched its section bottom at 120px, while chapter 3 began at 208px. At 1280×720 the long chapter-3 summary had 823px of content in a 688px region; keyboard PageDown reached its remaining 135px. With chapter 2's files collapsed, summary and section were both 598px high and containment held. At 600×720 all summaries were static with no height cap, no overlap with the following files, and no page horizontal overflow. The temporary viewport override was reset. Existing local progress and cached generation were preserved; no fresh model inference or external writes occurred.

Proof screenshot: `evidence/sticky-summary.jpg` (current section's summary pinned beside its scrolled, highlighted diff); saved to Library with the returned identity recorded separately.

## Project relocation · 2026-10-07

Moved the complete project root directly to `/Users/ryan/dev/ryvu` after confirming the destination did not exist. Stopped only the confirmed app server (PID 76998, old project cwd, loopback port 4317). A directory rename preserved dependencies, source/config, generated assets, private cache/data, evidence, permissions and symlinks; before/after verification matched 14,423 entries using file SHA-256 digests and modes. No Git metadata existed in the source project. The old project location is absent.

Updated the README run command to `cd ~/dev/ryvu`. From the new root, `npm test` rebuilt the server/browser app, passed both TypeScript checks, and passed all 11 tests. Restarted the same app detached with cwd `/Users/ryan/dev/ryvu`, PID 71311, listening on `127.0.0.1:4317`. IAB reloaded from the restarted server and reused the existing t3code #5 guide (same base/head commit IDs, visible cached status), displayed all four sections / 25 files, retained chapter-4 reading progress, and retained sticky summary styling. No fresh model inference or GitHub writes occurred. Browser progress stays at the unchanged localhost origin. No other projects or services were modified.
