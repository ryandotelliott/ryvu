# Find in diff

⌘F on the Diff or Guide page opens a find bar that searches the PR's diff text (the browser's own find cannot see virtualized rows). It counts matches, can include collapsed files, jumps between matches and highlights them.

## Sub-features

- `find-open` opens the bar with the input focused; ⌘F again reselects the text.
- `find-count` shows `i of n` for the query.
- `find-collapsed` includes collapsed files when `Search collapsed files` is pressed, opening a file on jump.
- `find-step` moves with Enter / Shift+Enter or ⌘G / ⇧⌘G, centring the match.
- `find-highlight` paints matches (`pr-find`) and the current one (`pr-find-current`).
- `find-close` closes on Esc and clears highlights.

## How to get to it (user POV)

- Press ⌘F (Ctrl+F) on `/pr/…/diff` or `/pr/…/guide`. On the Overview, ⌘F stays with the browser.

## Driving it with Playwright

Preconditions:

- A PR whose added lines contain a word of 7+ letters; the journey takes one from the PR's own patch.

- **Open.** `go('/pr/…/diff')`, `waitForDiffRows()`, press `Meta+f`. The focused element has aria-label `Find in diff`.
- **Count.** Fill the input with the term and make sure `Search collapsed files` has `aria-pressed="true"`. `.find-count` matches `^\d+ of \d+$`.
- **Step.** Press Enter in the input. `CSS.highlights.get('pr-find-current')` holds one range whose text equals the term, on screen between 108px and the viewport bottom.
- **Close.** Press Escape. `.find-bar` is gone.
- **Proof.** Screenshot with the highlighted current match.

## Gotchas

- Without `Search collapsed files`, only open files are searched; counts differ by design.
- The first jump after typing is debounced by 150ms; wait before reading positions.
- Highlights need the CSS Custom Highlight API (Chromium has it); read them from `CSS.highlights`, not the DOM.
- Search is case-insensitive and plain text; there is no regex mode.
