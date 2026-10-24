# PR Guide

A personal, localhost-only reading interface inspired by Linear's Guide view. The home page lists open pull requests from the repositories you choose in Settings. Opening one shows its description, conversation and diffs, where you can leave line comments and submit a review. **Analyze** turns the diff into purpose-based sections with before/after explanations, questions, and links to exact changed lines. Viewed files are remembered in this browser per head commit.

## Run

Node 22.12 or later, `pnpm`, `gh`, and the Codex CLI must be on PATH (`just` is optional; its recipes wrap the pnpm scripts). Real generation uses their existing sign-ins (`gh auth status`, `codex login status`). It does not create credentials. The selected model is `gpt-6-luna` with high reasoning.

```sh
cd ~/dev/ryvu
pnpm install
pnpm dev
```

`pnpm dev` (or `just dev`) runs the app on Vite with TanStack Start. Open **http://127.0.0.1:5173**, or set `WEB_PORT` for another port. One process serves the pages and the server functions. UI edits hot-reload in place, and an edit to a `src/*.functions.ts` file applies to the next call. An edit to any other server file directly in `src/` restarts the server's runtime. A running analysis stops, and an open page asks you to reload. Ctrl-C stops any running analysis and then the server.

`just start` builds and serves the production build at **http://127.0.0.1:4317** (`PORT=4318 just start` for another port). Both servers bind only to 127.0.0.1. Data (saved guides, drafts, settings) lives in `.data/`; `PR_GUIDE_DATA_DIR` points a server somewhere else, which is how verification runs stay isolated. `just typecheck` checks all sources; `just` lists every recipe.

Add repositories in **Settings** (or on the empty home page). The home page lists their open PRs through `gh`, with tabs for review requests, your own PRs and PRs with a cached guide, plus repository, author and draft filters. Press **⌘K** (Ctrl K elsewhere) to search: type to match titles, authors and `repo#number` (titles of older PRs are searched on GitHub as you type), or paste `1234`, `#1234`, `owner/repo#1234`, or any PR link including trailing paths such as `/changes?w=1`.

Opening a PR fetches it through `gh` without any model calls. **Analyze** sends its numbered snapshot hunks to Codex, which consumes normal account inference usage; ⇧↵ in search opens a PR's guide and analyzes it if needed. Guides are stored per head commit, so a PR is only analyzed again after new commits (or when you choose **Re-analyze**).

**Reviewing:** hover a line number and click **+** to comment (drag across line numbers for a range). Comments stay pending in the local database until you open **Review** and submit them with Comment, Approve or Request changes. Replies to existing threads post immediately. These are the only GitHub writes, and they happen only when you submit.

## What it covers

- The PR list keeps four tabs visible. List options contains searchable repository and author filters, draft visibility, and sorting by update date, creation date or repository, with matching sections.

- The shadcn Sidebar keeps app navigation above the files on Overview, Guide and Diff. Repositories can collapse, and the file tree compacts nested folders and truncates only the last name. Drag the sidebar edge to resize it; double-click to reset. Search files with the magnifying glass or `/`; use the adjacent display button to switch between folders and diff order or hide matching files. Press `F` or `⌘B` / `Ctrl+B` to toggle the sidebar.
- Chapters organized around intent and behavior, with evidence highlighting and links to each section's files.
- Display settings, remembered in this browser: unified/split layout, hidden whitespace-only changes, line wrapping, word highlights, line numbers and code size. Diffs render through `@pierre/diffs`.
- Markdown file headers have an icon button to toggle preview. Preview reads the full file at the PR's head commit, renders Mermaid diagrams and highlights fenced code with the diff viewer's light/dark themes. Deleted files preview the base version. Raw HTML is skipped and images open as links.
- shadcn base-nova components backed by Base UI (buttons, checkbox, menus, popovers, dialog, switch).
- Analyzed guides and pending review comments are stored in SQLite at `.data/ryvu.db` (Node's built-in `node:sqlite`, no extra service). Guides from the earlier `.data/cache` files are imported when the server first opens the database.
- Settings (repositories and home page preferences) are stored in `.data/settings.json`; the open-PR list is cached in memory for a minute.
- PR descriptions and comments render a safe Markdown subset (no raw HTML).
- Cancel an active generation; a newer request supersedes an earlier one for this browser session.
- Local progress and private, SHA/model/prompt-version-specific guide cache in `.data/cache`.
- Explicit limitations for missing/binary/partial patches; all changed files must be accounted for.
- Strict schema and exact hunk-range validation before a result is shown or cached.

## Boundaries

The app reads metadata, description and file patches, checking base/head SHAs before and after loading. Reading a PR fetches metadata, description, file patches, review threads and conversation comments. Expanding a hunk or opening a Markdown preview fetches full file contents at the snapshot's commit. It does not merge, edit issues or GitHub settings, publish or deploy. Marking a chapter read affects local progress only. Evidence validation establishes that referenced lines exist, not that every model explanation is correct. Independently review the code and questions.

Limits: 200 files / 120,000 patch characters per guide. GitHub omissions and changed-file limits are surfaced. Generation has an eight-minute timeout, output limits and subprocess-group cancellation. Temporary generation files are removed. Codex runs ephemerally in a temporary directory with read-only sandbox, no approval prompts, ignored user config/rules, disabled hooks, shell, browser, apps, agents and memory features. Its authentication still comes from the existing Codex account. Only supplied snapshot data is intended to be analyzed.

The server answers only requests whose Host names its own 127.0.0.1 or localhost port, and refuses another Origin and cross-site requests. Server functions also pass TanStack Start's CSRF check and carry the session token the page gets when it opens. The server refuses request bodies over 256 KB. There is no general-purpose command or arbitrary URL endpoint; `gh` is only called with validated repository names and PR numbers. Its browser assets are built locally, including syntax grammars.

## Validation

There is no automated test suite. `just typecheck` checks all sources, and `just build` builds the app and then type-checks it. To drive the real app in a browser and capture evidence, use the `verify-ryvu` skill in `.claude/skills/verify-ryvu/` (`SKILL.md` has the launch, doctor, drive and cleanup commands).
