# Diff files

The Diff page shows every changed file as a card with syntax-highlighted code. The shadcn Sidebar keeps app navigation above the files on Overview, Guide, and Diff. It lists files as folders by default, with a diff-order option, and can filter them or jump to one; the current file's header sticks below the toolbar while you read, and ticking Reviewed updates the toolbar's count.

## Sub-features

- `diff-draw` draws code rows for open files (virtualized; only rows near the screen exist).
- `line-selection` selects one line by clicking its number, clears it on a second click, and selects a range by dragging. Guide and Diff keep separate selections.
- `sidebar-toggle` opens and closes the review sidebar.
- `sidebar-resize` adjusts the width by dragging its edge or pressing arrow keys on the divider; double-click resets it. Width persists across reloads.
- `sidebar-tree` compacts nested folder chains and truncates only the last folder name.
- `sidebar-repositories` collapses the repository links to give files more room.
- `sidebar-progress` fills the active file row as you scroll through its diff, in both folder and diff-order views. Collapsed active files use a full fill without marking them reviewed.
- `sidebar-filter` narrows the list by path text.
- `sidebar-counts` shows per-file additions and deletions in both layouts; multi-PR ranges use the combined diff's counts (`journeys/stack-range.mjs`).
- `sidebar-jump` scrolls to a file, landing its card at 108px, and marks it current.
- `sticky-header` pins the current file's header 16px below the toolbar, with no code showing around it even mid-scroll.
- `reviewed` ticks a file reviewed and updates `N/M reviewed`; unchecking it reopens the file in the current view.
- `markdown-preview` switches a Markdown file between its diff and the full rendered file, with Mermaid diagrams and highlighted fenced code. Deleted files preview the base version.

## How to get to it (user POV)

- Open a PR and choose the `Diff` tab, or go to `/pr/<owner>/<repo>/<n>/diff`, or press `3` on a PR page.
- Toggle the sidebar with the panel icon in the top bar or the `f` key. The Files heading has `Search files` and `File list display` icon buttons; `/` opens the search panel with the filter focused. Escape clears and closes file search.
- Choose a file row in the sidebar.
- For Markdown files, click the `Preview Markdown` icon button in the file header. `Show diff` restores the patch; find and comment jumps return to Diff automatically.

## Driving it with Playwright

Preconditions:

- A PR with several files; `pickLargePull` takes the largest PR on the first inbox page.

- **Code draws.** `go('/pr/…/diff')`, `waitForDiffRows()`. `visibleRows()` is above 0 and `.diff-toolbar > .toolbar-progress` reads `0/M reviewed`.
- **Line selection** (`journeys/selection.mjs`). A Guide file chip highlights its saved reference. Clicking another gutter line replaces it; dragging selects a new range. Check the range after a redraw and tab switch, then save and delete a multi-line local draft.
- **Open sidebar.** Press `f` if `[data-slot=sidebar-container]` is absent. Choose `Diff order` in `File list display` for `.list-file` rows, or `Folders` for the virtualized tree.
- **Filter.** Click `Search files`, then fill `Filter files` with part of a file name. The row count drops but stays above 0; clear the filter.
- **Jump.** Click the row for a file further down. That file's `.diff-card` top is 108px (±2) and its row has `.is-current`.
- **Sticky header.** Scroll the wheel a few hundred pixels. The header of the card that spans the top of the view sits at top 108px.
- **Nothing shows around the pinned header** (`journeys/sticky-header.mjs`, `VERIFY_GUIDE_PR=…` runs it on a Guide). It records compositor frames with a CDP screencast during 60 fast wheel steps. In every frame, the 16px gap is pure page background, and the header's top corners and top line hold only palette colours.
- **Reading progress** (`journeys/file-progress.mjs`). Collapse the active file and check its fill stays at 100%, including while scrolling. Reopen it and check scroll-based progress returns. The full collapsed fill must not mark it reviewed. Scroll within a long file and assert the fill grows; scroll back and assert it shrinks. Jump to the next file and check its fill starts at zero. Run in both sidebar views and both themes.
- **Reviewed.** Click the first card's `.file-reviewed [role="checkbox"]`. The toolbar reads `1/M reviewed`.
- **Full-height navigation** (`journeys/review-sidebar.mjs`). Check the sidebar on all three views, its search panel, compact folder labels, resize persistence, shadcn collapse controls, navigation links, and the mobile Sheet.
- **Proof.** Screenshots of the drawn diff, the sidebar, the jump and the reviewed count.
- **Markdown preview** (`journeys/markdown-preview.mjs`). Use a real PR with Mermaid and fenced code, or `VERIFY_MARKDOWN_PR=owner/repo/number`. Compare the rendered heading, diagram labels and complete code fence with GitHub's full file. Change the system theme and assert diagrams redraw and syntax colors change. Switch back with an unsent comment, then jump to a local draft and a find match from Preview. Fail one file request and verify Retry succeeds. Never submit the draft to GitHub.

## Gotchas

- A card can exist with zero drawn rows (only a `data-virtualizer-buffer`); always assert rows, not cards. This caught a real bug: programmatic jumps left a file blank when React re-rendered before the browser's scroll event (fixed via `scrollPageBy` in `src/web/diff.tsx`).
- Hidden-file patterns persist per repository in localStorage; a fresh Playwright profile has none, but the sidebar may list fewer files than the PR if a journey sets one.
- Short files never scroll far enough for their header to stick; the journey notes that instead of failing.
- The `0/M reviewed` count excludes hidden files.
- Viewed state is shared with Guide and stored in this browser's localStorage per PR and head commit, without GitHub synchronization. Expansion choices are separate between the tabs.
- Screenshots at rest miss scroll leaks, because the compositor scrolls ahead of the main thread for a few frames. Anything that switches a header's look from script on scroll lagged like that, so pinning is pure CSS. Judge leaks from screencast frames only.
