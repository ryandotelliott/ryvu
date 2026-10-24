# Comments

Open review threads show under their code lines. Display settings switch threads between inline cards, right-side indicators, and hidden. The Review menu opens the summary and verdict form, with a link to local pending comments.

## Sub-features

- `threads-inline` shows unresolved threads on current lines as foldable cards.
- `comments-indicators` replaces inline threads with markers that open a popover.
- `comments-hidden` removes threads from the code.
- `review-menu` opens the review form and jumps to pending comments. The final Submit review action writes to GitHub.

## How to get to it (user POV)

- Open a PR's Diff tab and select a file with threads.
- Display settings → Comment location → Inline / Indicators / Hidden.
- Click Review in the top bar; its chevron indicates an expandable form.

## Driving it with Playwright

Preconditions:

- A PR with an unresolved thread on a line still in the diff; `pickPullWithOpenThread` scans the first ten inbox PRs.
- Never click Reply or Submit review. Add to review stores a local draft only.

- **Inline.** Select the thread's file through file search, then scroll until its comment link and author from GitHub are visible.
- **Indicators.** Display settings → radio `Indicators`, Escape. `.comment-indicator` exists and `.comment-fold` is gone.
- **Hidden.** Display settings → radio `Hidden`, Escape. Neither exists. Restore `Inline`.
- **Review.** `review-sidebar` opens and dismisses Review. `markdown-preview` uses Review → pending comments to reveal a local draft, then deletes it without submitting.
- **Proof.** Screenshots of the inline thread and indicator mode.

## Gotchas

- Display settings persist in localStorage; each `drive.mjs` run starts with a fresh profile. Restore `Inline` when finished.
- The PR with open threads changes as threads get resolved; the journey fails when none of the first ten PRs has a drawable thread.
- Code and comments are virtualized; selecting a file is not enough to prove that a thread is drawn.
