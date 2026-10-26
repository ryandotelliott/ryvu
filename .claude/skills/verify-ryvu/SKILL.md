---
name: verify-ryvu
description: Launch an isolated PR Guide (ryvu) instance and drive its browser UI with Playwright to prove a change works, saving screenshots and a transcript. Use after changing anything a user sees in PR Guide (inbox, ⌘K palette, Overview, Guide or Diff pages, file sidebar, find in diff, comments, display settings), when asked to verify, test or screenshot the app, or when a PR Guide page looks broken.
---

# Verify PR Guide

PR Guide is a local TanStack Start app for reviewing GitHub pull requests. Its server functions (`src/*.functions.ts`) read GitHub through the `gh` CLI, and its React pages call them. Users touch the browser UI only, so verification drives a real Chromium against a real server reading real GitHub data.

Everything below runs from the repo root. Scripts live in `.claude/skills/verify-ryvu/scripts/`; journeys (one per feature) in `journeys/`; the feature map in `features/`.

## Isolation and safety

- **Never drive the user's own instance** (`pnpm dev` on 5173/4317, or `pnpm start` on 4317). `launch.sh` starts a separate server on a free port with its own data directory (`PR_GUIDE_DATA_DIR=.verify/data-<port>`). It seeds that directory with *copies* of the user's settings and saved guides; their `.data/` is never written.
- **One instance per checkout.** `launch.sh` refuses to start if `.verify/instance.json` exists. Run `doctor.sh` to check it, or `cleanup.sh` to stop it.
- **GitHub is real and some actions write to it.** Posting a reply, "Add to review" followed by "Submit review", and approving all write to the real PR. Journeys never click those. Drafts ("Add to review" alone) are local to the instance's database and are safe.
- **Analysis is not free.** "Analyze" and "Re-analyze" run Codex for minutes. Journeys use guides already saved in the seeded database. Only `lifecycle` and `dev-reload` start an analysis, and they refuse to run unless `launch.sh` put a stand-in `codex` (`scripts/stub-codex.sh`) first on the server's PATH with `VERIFY_STUB_CODEX=1`.

## Setup (once per machine)

```sh
.claude/skills/verify-ryvu/scripts/setup.sh
```

Installs Playwright 1.57 and Chromium into `.claude/skills/verify-ryvu/.harness/` (git-ignored). Prints `harness ready: 1.57.0`. Requires `gh` signed in (`gh auth status`).

## Launch

```sh
.claude/skills/verify-ryvu/scripts/launch.sh
```

- Runs the production build by default. It rebuilds with `pnpm build` when `dist/` is missing or older than any source file, so you never verify stale code. Force it with `VERIFY_REBUILD=1`.
- `VERIFY_MODE=dev` runs the Vite dev server instead, with no build.
- Picks a free port (or `VERIFY_PORT=4390`).
- Seeds repositories from `.data/settings.json` (or `VERIFY_REPOS=owner/repo,owner/repo`) and snapshots `.data/ryvu.db` read-only for saved guides and drafts (`VERIFY_COPY_DB=0` starts empty). In a worktree without `.data/`, point `VERIFY_SEED_DIR` at the checkout that has it.
- Starts `node scripts/start.mjs` (or `node node_modules/vite/bin/vite.js dev`) directly, so the recorded pid is the server, and waits until `/` returns 200.

Ready means it prints `ready: http://127.0.0.1:<port> (<mode>, pid …, data …)` and writes `.verify/instance.json` (`pid`, `port`, `url`, `mode`, `entry`, `dataDir`, `log`, `stubDir`). The server log is `.verify/logs/server-<port>.log`.

Some tool runners kill background processes when the shell that started them exits. Run launch, doctor, the drives and cleanup in one shell command there.

From a truly empty data dir (no settings anywhere and no `VERIFY_REPOS`) the app is usable but the inbox is empty. Every journey except `guide` needs at least one repository with open PRs.

## Doctor

```sh
.claude/skills/verify-ryvu/scripts/doctor.sh
```

Read-only. Exits 0 only if all of these hold:

- the recorded pid is running the recorded entry, from this checkout
- that pid owns the port
- the process runs with the scratch `PR_GUIDE_DATA_DIR`
- a request with a foreign Host header gets 403
- a real browser opens `/settings`, which needs the page's session call to succeed, and repositories are seeded
- `gh` is signed in
- the harness is installed

For the production build it warns when sources changed after the build: run `cleanup.sh` then `launch.sh` to rebuild. Run doctor first whenever anything looks off.

## Drive

```sh
node .claude/skills/verify-ryvu/scripts/drive.mjs <journey> [--dark] [--headed]
```

`<journey>` is a file in `journeys/`. Exit code 0 means every check passed. Every run also fails on an uncaught page error or a Content-Security-Policy violation.

- Feature journeys: `inbox`, `diff-files`, `sticky-header`, `find`, `comments`, `guide`.
- `expansion` (needs `VERIFY_GUIDE_PR`): unviewed Guide blocks start expanded; manual toggles, viewed actions and bulk controls preserve the other tab's expansion; viewed state survives reloads.
- `guide-scroll` (needs `VERIFY_GUIDE_PR` with a long explanation): wheel scrolling continues onto the page at both edges of the explanation, including in a short viewport.
- `selection` (needs `VERIFY_GUIDE_PR` with a multi-line reference): gutter clicks replace Guide highlights, repeated clicks clear selection, ranges survive redraws and tab switching, and a multi-line local draft survives reload. It deletes the draft without submitting a review.
- `loading` (needs `VERIFY_GUIDE_PR`): inbox placeholder heights at desktop and mobile widths, solid code placeholders, cached PR revisits during a delayed refresh, local drafts preserved during that refresh, and the Analyze shortcut reusing a saved Guide after refreshing.
- `review-sidebar`: full-height app navigation and files on all review views, compact folder labels, resizing and saved width, file search, file display settings, shadcn collapse controls, and the mobile Sheet.
- `inbox-options`: nested list controls, searchable repository and author subpanels, date/repository sections, paginated ordering and narrow-screen fitting.
- `inbox-cache`: cached matches appear during delayed tab requests, partial lists do not claim completion, merged rows stay ordered and unique, and sort survives tab changes, navigation and reload.
- `tooltip-layout`: short control labels stay on one line; long file paths wrap inside a tooltip that fits the longest line; keyboard hints stay visible, including on a narrow viewport.
- `file-progress`: the active file row fills as the diff scrolls, reverses when scrolling up, and resets on the next file, in both folder and diff-order views.
- `scrolling`: compositor frames keep popovers attached to sticky controls while the page scrolls; the file list and folder tree scroll independently and contain scrolling at both edges. Needs a PR with enough files to overflow the sidebar.
- `markdown-preview`: a Markdown file's Preview toggle renders its full contents, Mermaid diagrams and highlighted code in both themes. It checks returning to Diff, preserving an unsent comment, comment jumps, find and retry after a failed file request. Picks from the inbox, or set `VERIFY_MARKDOWN_PR=owner/repo/number` to a PR with Mermaid and a supported fenced code example. It adds and removes one local draft without submitting a review.
- `markdown-rendering` (needs `VERIFY_MODE=dev`): exercises the real rendering helpers in the browser to check escaped code, Mermaid directives that attempt to enable HTML, and cleanup after an invalid diagram. It supplements the UI journey without mocking GitHub.
- `navigation`: deep links to every view, the `/changes` alias, old `#/` links, unknown paths, in-app links and keys, back and forward.
- `view-scroll` (needs `VERIFY_GUIDE_PR`): Overview, Guide and Diff keep separate scroll positions across tabs, keyboard navigation, Back and Forward; an explicit sidebar file jump overrides the saved position.
- `stack` (optional `VERIFY_STACK_PR`): stack order, current PR, diff stats, keyboard navigation and switching PRs without changing view.
- `stack-loading` (optional `VERIFY_STACK_PR`): a stack member's known title stays visible while its details load. In dev, it also seeds an older browser-cache title and checks that fresh GitHub data replaces it.
- `persistence`: a settings change and a pending comment survive a reload. The comment is local until Submit review, which it never clicks.
- `security`: raw requests with a foreign Host or Origin, a cross-site fetch, no session token, no CSRF headers, or an oversized or non-JSON body. It replays the page's own server-function requests.
- `lifecycle` (needs `VERIFY_STUB_CODEX=1` and `VERIFY_GUIDE_PR`): `?analyze=1`, Cancel, a job that outlives navigation, and a shutdown that waits for the job's child process. It stops the server with SIGINT in dev and SIGTERM in production. `VERIFY_SIGNAL=SIGHUP` (or `SIGINT`, `SIGTERM`) sends that signal instead. Run `cleanup.sh` after it.
- `dev-reload` (needs `VERIFY_MODE=dev VERIFY_STUB_CODEX=1` and `VERIFY_GUIDE_PR`): hot reload of a UI edit, then five edits to `listPulls` while an analysis runs. After the first, a stand-in that exits on its own shows its failure on the Guide, which only polling can deliver. After each of the other four, made from the Guide or the list, the list shows the titles the new code returns on the same session, and the Guide still shows the running job with Cancel and keeps polling it. Cancel then ends that job's stand-in. Next, on the Diff of the largest PR, it types a comment on an added line without adding it, then edits `listPulls` and `getPull`. After each edit the same textarea still holds the text and the line is still drawn, and a later load shows the title the edited `getPull` returns. Last, a runtime restart stops a running job, refuses an analysis started while it closes and then asks the page to reload. Any console error fails it. It rewrites `src/web/shell.tsx`, `src/inbox.functions.ts`, `src/pull.functions.ts` and `src/settings.ts` and restores them at the end, so it refuses to run while git shows changes to any of them. Run it in a clean worktree, never in a checkout with work in progress. A killed run leaves `verify-ryvu reload probe` in those files.

Each journey picks real PRs from the rendered inbox (see `journeys/_pick.mjs`) rather than hard-coding numbers, because PRs open, close and change. `guide` needs a PR with a saved guide at its current commit. Pass `VERIFY_GUIDE_PR=owner/repo/number` if the "Guide ready" tab is empty.

To verify something no journey covers, add a journey (or a temporary `journeys/_scratch.mjs`) using the helpers `drive.mjs` passes in:

| Helper | Use |
|---|---|
| `page` | The Playwright page (1440×900). |
| `out` | The run's evidence folder, for artifacts other than screenshots. |
| `instance` | The recorded instance: `pid`, `port`, `mode`, `dataDir`, `stubDir`. |
| `go(path)` | Open an app route: `/`, `/settings`, `/pr/<owner>/<repo>/<n>`, `…/guide`, `…/diff`. |
| `check(cond, msg)` | Record a passing check, or fail the run with `msg`. |
| `shot(label)` | Numbered screenshot into the evidence folder. |
| `note(text)` | Line in the transcript. |
| `inbox()` | Open `/` and read the rendered rows: `repo`, `number`, `title`, `additions`, `deletions`, `path`. |
| `github(route)` | Read a GitHub REST route through `gh api --paginate`, such as `repos/o/r/pulls/1/files?per_page=100`. GET only. |
| `githubQuery(query, variables)` | Run a GraphQL query through `gh api graphql`. Mutations are refused. |
| `waitForDiffRows()` | Wait until a diff has actually drawn code rows. |
| `visibleRows()` | Count drawn rows in diff cards on screen. |

Stable handles in this app (prefer these over coordinates):

- **Routes:** `/pr/<owner>/<repo>/<n>` (Overview), `/guide`, `/diff`. Home tabs use `?tab=review|mine|guides`.
- **Inbox:** `a.pull-row:not(.skeleton)` and `.pull-title`. The ⌘K input has placeholder `Search pull requests, or paste a link or number`.
- **PR page:**
  - `.view-tabs a[aria-current="page"]` and `.pr-heading h1`.
  - Toolbar: `.diff-toolbar > .toolbar-progress` (`N/M reviewed`).
  - Display settings: `.toolbar-actions [aria-label="Display settings"]` opens a popover whose radios and checkboxes have accessible names (`Split view`, `Inline`, `Indicators`, `Hidden`, `Wrap long lines`…). It has buttons `Expand` and `Collapse`.
- **Sidebar:**
  - Opening and filtering: ⌘B (Ctrl+B) toggles `[data-slot=sidebar-container]`, and so do `Hide sidebar` inside it and `Show sidebar` in the top bar once it is hidden; `Search files` or `/` opens the panel with placeholder `Filter files`, and rows are `.list-file` (current row: `.list-file.is-current`).
  - Resize: `[data-slot=sidebar-rail]` accepts pointer drags, Left/Right keys, and a double-click to reset; width persists across reloads.
  - Display options: `File list display` button, with `Diff order` and `Folders` radios and the `Hide files matching patterns` switch.
- **Diffs:**
  - Cards: `.diff-card` (`.expanded` when open), with the header `.file-heading`. It pins at 108px once its card scrolls under the toolbar (64px on the Guide). Pinning is pure CSS, so there is no class to wait for: compare the header's top with its card's.
  - The Reviewed checkbox is `.file-reviewed [role="checkbox"]`.
- **Inside a diff:** the code is in `diffs-container`'s **open shadow root**:
  - Rows: `[data-line][data-line-type="context|change-addition|change-deletion"]`.
  - Separators: `[data-separator=line-info]`, with buttons `[data-expand-up|down|both|all-button]`.
- **Comments:**
  - Inline threads are `.comment-fold`. Review → pending comments jumps to a local draft.
  - Indicator mode draws `.comment-indicator`.
- **Find:**
  - ⌘F (Ctrl+F) opens `.find-bar`. The input's label is `Find in diff`, the count is `.find-count` (`3 of 42`), and collapsed files are always searched. On Guide, the floating bar aligns with the sticky file headers.
  - Matches are CSS Custom Highlights `pr-find` and `pr-find-current`; read them with `CSS.highlights.get(...)`.

## Evidence

Each run writes `.verify/evidence/<ISO time>-<journey>/` (git-ignored):

- `NN-<label>.png` screenshots taken at each step
- `transcript.md` with every step and check
- `result.json` with status, check count, page errors, console errors and duration
- `failure.png` on failure

Proof standards:

- **Use the real user path:** keys, clicks and routes. Use `github()` only to *choose* data or to read the expected values from GitHub, never to perform the action under test.
- **Capture the action and the result,** not only the final screen. A journey with one screenshot at the end proves little.
- **Verify drawn content, not just structure.** The diff renderer is virtualized, so a card can exist with zero drawn rows (an empty `data-virtualizer-buffer`). Assert `visibleRows() > 0` or specific rows in the shadow root.
- **Verify side effects through a second view.** For example, ticking Reviewed must change the toolbar count.
- **No mocks.** GitHub and `gh` are real. The fakes are the scratch data directory and, when asked for, the stand-in `codex`.

## Cleanup

```sh
.claude/skills/verify-ryvu/scripts/cleanup.sh
```

- **What it stops.** It kills only the recorded pid, and only if that pid still runs the recorded entry from this checkout. Then it kills the process group of any stand-in `codex` still running from the instance's stub directory.
- **What it removes.** It deletes the scratch `.verify/data-<port>/` and `instance.json`.
- **What it keeps.** It never removes `.verify/evidence/` or `.verify/logs/`.
- **After a failed attempt,** run it too, so no server is left holding a port.

## Helpers

| Script | Invocation |
|---|---|
| `scripts/setup.sh` | `.claude/skills/verify-ryvu/scripts/setup.sh` |
| `scripts/launch.sh` | `[VERIFY_MODE=dev] [VERIFY_REPOS=…] [VERIFY_SEED_DIR=…] [VERIFY_PORT=…] [VERIFY_COPY_DB=0] [VERIFY_REBUILD=1] [VERIFY_STUB_CODEX=1] .claude/skills/verify-ryvu/scripts/launch.sh` |
| `scripts/doctor.sh` | `.claude/skills/verify-ryvu/scripts/doctor.sh` |
| `scripts/drive.mjs` | `[VERIFY_GUIDE_PR=owner/repo/n] [VERIFY_SIGNAL=SIGHUP] node .claude/skills/verify-ryvu/scripts/drive.mjs <journey> [--dark] [--headed]` |
| `scripts/cleanup.sh` | `.claude/skills/verify-ryvu/scripts/cleanup.sh` |

The feature map in `features/README.md` lists what to verify and how. A proof that drives one convenient entry point is incomplete when the map lists others.
