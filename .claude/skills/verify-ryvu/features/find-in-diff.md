# Find in diff

⌘F on the Diff or Guide page opens a find bar that searches the PR's diff text (the browser's own find cannot see virtualized rows). It searches collapsed files automatically, counts matches, jumps between matches and highlights them. On Guide, the floating search bar sits at the same top offset as the sticky file headers.

## Sub-features

- `find-open` opens the bar with the input focused and uses selected text as the query. With no new page selection, it keeps the previous query and current match. ⌘F inside the search bar only refocuses and selects its query.
- `find-count` shows `i of n` for the query.
- `find-collapsed` always includes collapsed files and opens a matching file when jumping to it.
- `find-step` moves with Enter / Shift+Enter or ⌘G / ⇧⌘G, centring the match.
- `find-expanded` jumps directly to matches below expanded unchanged context without scrolling through the intervening lines.
- `find-highlight` paints matches (`pr-find`) and the current one (`pr-find-current`).
- `find-close` closes on Esc and clears highlights.

## How to get to it (user POV)

- Press ⌘F (Ctrl+F) on `/pr/…/diff` or `/pr/…/guide`. On the Overview, ⌘F stays with the browser.

## Driving it with Playwright

Preconditions:

- A PR whose added lines contain a word of 7+ letters; the journey takes one from the PR's own patch.

- **Open.** `go('/pr/…/diff')`, `waitForDiffRows()`, press `Meta+f`. The focused element has aria-label `Find in diff`.
- **Count.** Collapse all files through Display settings, then fill the input with the term. `.find-count` matches `^\d+ of \d+$`.
- **Step.** Press Enter in the input. `CSS.highlights.get('pr-find-current')` holds one range whose text equals the term, on screen between 108px and the viewport bottom.
- **Expanded context** (`journeys/find-expanded.mjs`). Set `VERIFY_FIND_PR=owner/repo/number` to a PR with a changed line after at least 2000 unchanged lines, and optionally `VERIFY_FIND_FILE` to choose the file. Expand the large gap, then search for a changed line below it. The highlighted result must be visible within six programmatic scroll adjustments. The journey saves the scroll calls as evidence.
- **Selection.** Select a different word in a rendered diff, then press ⌘F. The input contains that word, including when it came from the diff renderer's shadow DOM. Close and reopen with no selection to check that the query is retained.
- **Close.** Press Escape. `.find-bar` is gone.
- **Proof.** Screenshot with the highlighted current match.

## Gotchas

- Hidden files remain excluded. Collapsing a file does not change the search results.
- Set `VERIFY_GUIDE_PR=owner/repo/number` to also check searching collapsed Guide blocks and the floating search bar at desktop and mobile widths.
- The first jump after typing is debounced by 150ms; wait before reading positions.
- Highlights need the CSS Custom Highlight API (Chromium has it); read them from `CSS.highlights`, not the DOM.
- Search is case-insensitive and plain text; there is no regex mode.
