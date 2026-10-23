# Comments

Open review threads show in the code. The Comments list (`C`) lists every thread by file and line, folds resolved ones into a section, and jumps to a thread. Display settings switch threads between inline, right-side indicators and hidden.

## Sub-features

- `threads-inline` shows unresolved threads on current lines as foldable cards; resolved and outdated threads stay off the file.
- `comments-list` opens with `C` (toggle) or the top-bar comments button.
- `comments-jump` scrolls to a thread and highlights it (outdated threads open the Overview instead).
- `comments-indicators` replaces inline threads with markers that open a popover.
- `comments-hidden` removes threads from the code; jumping to one reveals just that thread.

## How to get to it (user POV)

- Open a PR's Diff tab; threads appear under their lines.
- Press `c`, or click the speech-bubble button with the count in the top bar.
- Display settings (sliders icon, right of "lines left") → Comment location → Inline / Indicators / Hidden.

## Driving it with Playwright

Preconditions:

- A PR with an unresolved thread on a line still in the diff; `pickPullWithOpenThread` scans the first ten inbox PRs.
- Never click Reply, Add to review or Submit review.

- **List.** `go('/pr/…/diff')`, `waitForDiffRows()`, click the page body, press `c`. `.comments-menu` lists at least as many `.comments-menu-item` rows as open threads.
- **Jump.** Click the first item. A `.comment-fold.is-focused` sits on screen (between 100px and 900px).
- **Indicators.** Display settings → radio `Indicators`, Escape. `.comment-indicator` exists and `.comment-fold` is gone.
- **Hidden.** Display settings → radio `Hidden`, Escape. Neither exists. Restore `Inline`.
- **Proof.** Screenshots of the list, the focused thread and indicator mode.

## Gotchas

- `c` is ignored while typing in an input; click the page body first.
- Display settings persist in localStorage; each `drive.mjs` run starts with a fresh profile, but reset to `Inline` when you finish.
- The PR with open threads changes as threads get resolved; the journey fails with a clear message when none of the first ten PRs has one.
- Jumping is a scroll the diff virtualizer must hear about; a regression here shows as a blank card where the thread should be.
