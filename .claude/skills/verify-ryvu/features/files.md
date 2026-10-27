# Files

The Files tab reads whole files at any branch of the PR's repository. It opens on the default branch. The branch picker lists the default branch, the PR's base and head, then recent branches, and typing searches every branch on GitHub. On a branch with changes, changed files show their line counts in the tree and can be listed alone. An open file marks new lines green and changed lines blue, and a red notch shows where lines were removed. It is not a diff. Each diff file header's `…` menu opens the old or new file here, or starts a comment on the whole file.

## Sub-features

- `file-menu`: the `…` button after Reviewed offers Add file comment, View old file and View new file. Old is disabled for added files and new for deleted ones. Ranges have no comments, so they offer only the two views.
- `view-file`: View new file opens the PR's head branch, pinned to the reviewed head commit. View old file opens its base, pinned to the base commit. The URL is `/files?branch=<name>&path=<path>`.
- `change-marks`: new and changed lines are tinted with a gutter bar. `j`/`k` and the toolbar arrows step between changes, and the toolbar counts them.
- `branch-picker`: switch branches and keep the open file. The PR's head shows the PR's own changes. Any other branch shows its changes against the default branch, which GitHub caps at 300 files.
- `changed-only`: the Only changed files switch narrows the tree to the branch's changes, including deleted files. It is remembered in this browser.
- `file-comments`: a comment on the whole file sits above the file's diff on Diff and Guide. It is a local draft until Submit review, which adds it to the GitHub review as a file-level thread.

## How to get to it (user POV)

- Click the Files tab or press `4` on a PR.
- On Diff or Guide, open a file header's `…` menu and choose View old file or View new file.
- On Files, click the branch button under the Files label to switch branch. Show diff returns to the file on Diff.

## Driving it with Playwright

Preconditions:

- A PR in the first ten inbox rows that modifies a file and adds lines (`journeys/files.mjs` picks one through `github()`).
- Never click Submit review. Add to review stores the file comment as a local draft, and the journey deletes it.

- **Menu.** On Diff, `.diff-card .file-heading .file-menu` opens a menu with items named `Add file comment`, `View old file` and `View new file`.
- **File.** The code is in `.file-viewer diffs-container`'s open shadow root. Rows are `[data-line="N"]` and gutters `[data-column-number="N"]`. Marks are CSS in that root, so compare a marked row's computed background with an unmarked one.
- **Sidebar.** `.branch-trigger` opens the picker, with input placeholder `Find a branch…` and options named by branch. `.branch-changes` holds the count and the `Only changed files` switch. Tree rows pierce the tree's shadow root as `.repo-files [data-item-path="…"]`.
- **Comments.** `.file-comments` holds file threads, drafts and the composer (`.composer-label` reads `Comment on this file`).
- **Proof.** Screenshots of the menu, a marked change after `j`, the changed-only tree, the old file, the branch search and the pending file comment.

## Gotchas

- Branch lists, trees and files are cached for the session per commit; a reload refetches the branch list.
- Drafts left by an earlier failed run stay in the scratch database, so find a new draft by its text rather than by position.
- The Switch thumb animates; a screenshot right after clicking it can show the old position while the tree already changed.
- Deep folders in the full tree truncate names at the default sidebar width; widen the sidebar or use Only changed files, which compacts single-child folders.
