# PR Guide verification map

The maintained source for verifying what a PR Guide user can see and do. Read this index before driving the app, then use the matching feature file as the recipe. Each feature has a runnable journey in `../journeys/` with the same scope.

## Baseline preconditions

- An instance started by `scripts/launch.sh` in this run, recorded in `.verify/instance.json`. Never drive the user's own `pnpm dev` or `pnpm start` server.
- `scripts/doctor.sh` exits 0: our pid owns the port, the scratch data dir is in use, `gh` is signed in, and the harness is installed.
- The seeded settings list at least one repository with open PRs (copied from `.data/settings.json`, or `VERIFY_REPOS`).
- For the Guide, a PR with a saved guide at its current commit (copied from `.data/ryvu.db`, or named with `VERIFY_GUIDE_PR`).

## Driving conventions

- Drive through `node .claude/skills/verify-ryvu/scripts/drive.mjs <journey>`; it records every step.
- Use keys, clicks and routes the way a user would. `github()` and `githubQuery()` are for choosing a PR or reading expected values from GitHub, never for performing the action under test.
- Prefer accessible names and the stable handles listed in `SKILL.md` over coordinates. Code rows live in each `diffs-container`'s open shadow root.
- Never click Reply, Add to review → Submit review, Approve, Analyze or Re-analyze: they write to GitHub or run Codex.
- Start each recipe from a fresh page; `drive.mjs` gives every run a new browser profile (no saved display settings, reviewed files or hidden patterns).

## Proof and skip reporting

- Capture the action and the resulting state with `shot()` and `check()`, not only the final screen.
- For diffs, prove code was drawn (`visibleRows() > 0`), not just that a card exists; the renderer is virtualized.
- Prove side effects through a second view (e.g. the toolbar count after ticking Reviewed).
- A missing precondition fails the journey with the reason; never weaken a journey to make it pass. Record the reason in that feature's Gotchas.
- Report an entry point you could not reach as unverified rather than covering it through a different path.

## Feature entry contract

Each file starts with an H1 and a paragraph describing the user-visible behaviour, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright` (starting with `Preconditions:`), and `Gotchas`.

## Features

- [Inbox and ⌘K](./inbox.md) (`journeys/inbox.mjs`): the PR list, tabs, the command palette, opening a PR.
- [Diff files](./diff-files.md) (`journeys/diff-files.mjs`, `journeys/review-sidebar.mjs`, `journeys/file-progress.mjs`, `journeys/sticky-header.mjs`, `journeys/markdown-preview.mjs`): drawing diffs, the file sidebar, filtering, jumping, sticky headers, Reviewed, rendered Markdown with Mermaid and syntax highlighting.
- [Find in diff](./find-in-diff.md) (`journeys/find.mjs`, `journeys/find-expanded.mjs`): ⌘F search, collapsed files, match highlighting, and direct jumps past expanded context.
- [Comments](./comments.md) (`journeys/comments.mjs`): inline threads, indicator popovers, and display modes.
- [Guide](./guide.md) (`journeys/guide.mjs`): saved walkthroughs, file chips, section navigation.

Cross-cutting journeys without a feature file: `loading` (placeholder geometry and cached revisits), `stack` (stack navigation), `stack-loading` (cached titles while switching PRs and stale-title replacement), `tooltip-layout` (single-line control labels, wrapped file paths and viewport fitting), `scrolling` (popovers on sticky controls and independent sidebar scrolling), `navigation` (routes, links, history), `view-scroll` (separate scroll positions for Overview, Guide and Diff), `persistence` (a settings change and a pending comment across a reload), `security` (the local request rules), `lifecycle` and `dev-reload` (analysis jobs, shutdown and dev reloads, with the stand-in Codex). `SKILL.md` lists their preconditions.

Not yet mapped: adding and reordering repositories in Settings, hidden-file patterns, expanding unchanged lines, display settings beyond comment mode, the Overview sidebar, and Submit review (writes to GitHub; verify against a throwaway PR only).
