# PR Guide

A personal, localhost-only reading interface inspired by Linear's Guide view. The home page lists open pull requests from the repositories you choose in Settings. Opening one shows its description, conversation and diffs, where you can leave line comments and submit a review. **Analyze** turns the diff into purpose-based sections with before/after explanations, questions, and links to exact changed lines. Viewed files are remembered in this browser per head commit.

## Run

Node 22 or later, `pnpm`, `gh`, and the Codex CLI must be on PATH (`just` is optional; its recipes wrap the pnpm scripts). Real generation uses their existing sign-ins (`gh auth status`, `codex login status`). It does not create credentials. The selected model is `gpt-6-luna` with high reasoning.

```sh
cd ~/dev/ryvu
pnpm install
pnpm dev
```

`pnpm dev` (or `just dev`) compiles the server in watch mode, restarts it on change, and runs the Vite dev server with hot reload in front of it. Open **http://127.0.0.1:5173**. Ctrl-C stops all of it, and if any one process exits the rest are stopped too. `PORT` sets the API port (default 4317) and `WEB_PORT` the dev page port (default 5173).

`just start` builds and serves the production bundle at **http://127.0.0.1:4317** (`PORT=4318 just start` for another port). Both servers bind only to 127.0.0.1. `just typecheck` checks both server and browser sources; `just` lists every recipe.

Add repositories in **Settings** (or on the empty home page). The home page lists their open PRs through `gh`, with tabs for review requests, your own PRs and PRs with a cached guide, plus repository, author and draft filters. Press **⌘K** (Ctrl K elsewhere) to search: type to match titles, authors and `repo#number` (titles of older PRs are searched on GitHub as you type), or paste `1234`, `#1234`, `owner/repo#1234`, or any PR link including trailing paths such as `/changes?w=1`.

Opening a PR fetches it through `gh` without any model calls. **Analyze** sends its numbered snapshot hunks to Codex, which consumes normal account inference usage; ⇧↵ in search opens a PR's guide and analyzes it if needed. Guides are stored per head commit, so a PR is only analyzed again after new commits (or when you choose **Re-analyze**).

**Reviewing:** hover a line number and click **+** to comment (drag across line numbers for a range). Comments stay pending in the local database until you open **Review** and submit them with Comment, Approve or Request changes. Replies to existing threads post immediately. These are the only GitHub writes, and they happen only when you submit.

## What it covers

- Chapters organized around intent and behavior, with evidence highlighting and a filterable outline sidebar (press `/`) listing each section's files.
- Display settings, remembered in this browser: unified/split layout, hidden whitespace-only changes, line wrapping, word highlights, line numbers and code size. Diffs render through `@pierre/diffs`.
- shadcn base-nova components backed by Base UI (buttons, checkbox, menus, popovers, dialog, switch).
- Analyzed guides and pending review comments are stored in SQLite at `.data/ryvu.db` (Node's built-in `node:sqlite`, no extra service). Guides from the earlier `.data/cache` files are imported on startup.
- Settings (repositories and home page preferences) are stored in `.data/settings.json`; the open-PR list is cached in memory for a minute.
- PR descriptions and comments render a safe Markdown subset (no raw HTML).
- Cancel an active generation; a newer request supersedes an earlier one for this browser session.
- Local progress and private, SHA/model/prompt-version-specific guide cache in `.data/cache`.
- Explicit limitations for missing/binary/partial patches; all changed files must be accounted for.
- Strict schema and exact hunk-range validation before a result is shown or cached.

## Boundaries

The app reads metadata, description and file patches, checking base/head SHAs before and after loading. Reading a PR fetches metadata, description, file patches, review threads and conversation comments. It does not read checks, fetch surrounding code, merge, edit issues or settings, publish or deploy. Marking a chapter read affects local progress only. Evidence validation establishes that referenced lines exist, not that every model explanation is correct. Independently review the code and questions.

Limits: 200 files / 120,000 patch characters per guide. GitHub omissions and changed-file limits are surfaced. Generation has an eight-minute timeout, output limits and subprocess-group cancellation. Temporary generation files are removed. Codex runs ephemerally in a temporary directory with read-only sandbox, no approval prompts, ignored user config/rules, disabled hooks, shell, browser, apps, agents and memory features. Its authentication still comes from the existing Codex account. Only supplied snapshot data is intended to be analyzed.

The local API checks Host and Origin, requires a per-server session token, and exposes no general-purpose command or arbitrary URL endpoint; `gh` is only called with validated repository names and PR numbers. Its browser assets are built locally, including syntax grammars.

## Validation

There is no automated test suite. `just typecheck` checks the server and browser sources, and `just build` type-checks and builds both.
