# Guide

A PR with a saved analysis shows a Guide: sections that group changed files by intent, each with an explanation beside its diffs. Unviewed code blocks start expanded, and expansion choices are separate from the Diff tab. File chips jump to a diff, `j`/`k` move between sections, and a rail on the left marks each section.

## Sub-features

- `guide-sections` renders saved sections with titles, explanations and diffs.
- `guide-rail` shows one tick per section and marks the current one.
- `guide-chip` opens and scrolls to a file's diff from its chip.
- `guide-keys` moves to the next or previous section with `j` / `k`, landing it at 64px.
- `guide-expansion` opens unviewed blocks initially and keeps expansion independent of Diff.
- `guide-scroll` lets wheel scrolling continue onto the page at both ends of a long explanation.

## How to get to it (user POV)

- Open a PR and choose the `Guide` tab, go to `/pr/<owner>/<repo>/<n>/guide`, or press `2` on a PR page.
- From the inbox's `Guide ready` tab, open any row.

## Driving it with Playwright

Preconditions:

- A saved guide for the PR's current commit, from the seeded database. If `Guide ready` is empty, set `VERIFY_GUIDE_PR=owner/repo/number` (for this repo's author, `ryandotelliott/t3code/5` has one).
- Never click Analyze or Re-analyze.

- **Sections.** `go('/pr/…/guide')`, wait for `.section-rail button`. `.chapter-section` count equals the rail's button count and is above 0.
- **Chip.** Click the first section's first `.chapter-file`. The diff card with that file name is `.expanded` and on screen.
- **Keys.** Click the noninteractive title in the top bar, then press `j`. Some `.chapter-section` top is 64px (±2).
- **Expansion** (`journeys/expansion.mjs`). Toggle files and bulk controls in both tabs; marking a file viewed collapses it only in the active tab. Reload and check that viewed blocks start collapsed and unviewed blocks start expanded.
- **Scrolling** (`journeys/guide-scroll.mjs`). In a short viewport, wheel down at the explanation's bottom and up at its top. The page should move in both directions.
- **Proof.** Screenshots of the Guide and the position after `j`.

## Gotchas

- The loading skeleton also renders a `.chapter-section`; wait for `.section-rail button`, which only the real guide has.
- A guide is tied to a head commit; new pushes make the Guide page offer "Analyze" instead (`.analyze-empty`), which the journey reports as a failed precondition.
- The seeded `Guide ready` tab only lists guides for repositories in the seeded settings.
