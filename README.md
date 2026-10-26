# PR Guide

A personal, localhost-only reading interface inspired by Linear's Guide view. The home page lists open pull requests from the repositories you choose in Settings. Opening one shows its description, conversation and diffs, where you can leave line comments and submit a review. **Analyze** turns the diff into purpose-based sections with before/after explanations and links to exact changed lines. Viewed files are remembered in this browser per head commit.

## Setup

### Install prerequisites

- [Node.js](https://nodejs.org/en/download), version 22.12 or later.
- Git to clone the repository.
- [pnpm](https://pnpm.io/installation) to install dependencies and run the app.
- [GitHub CLI](https://cli.github.com/) (`gh`) to read PRs and post reviews with your GitHub account.
- [Codex CLI](https://developers.openai.com/codex/cli) (`codex`) to generate guides with **Analyze**. Browsing PRs and reading saved guides does not require Codex.

Install the CLIs on the machine that runs the app server. Keep `gh` on its `PATH`, and add `codex` there to use **Analyze**. `just` is optional; its recipes wrap the pnpm scripts.

### Sign in to the CLIs

If you have not already signed in, run:

```sh
gh auth login --hostname github.com
codex login
```

Use a GitHub account with access to the repositories you want to review. Confirm both sign-ins before using **Analyze**:

```sh
gh auth status --hostname github.com
codex login status
```

Ryvu reuses these CLI sign-ins. It does not require a separate app login or an API key configured in the app.

### Start the app

```sh
git clone https://github.com/ryandotelliott/ryvu.git
cd ryvu
pnpm install --frozen-lockfile
pnpm dev
```

If you already cloned the repository, start with `cd` into that checkout.

Open **http://127.0.0.1:5173**. Add a repository as `owner/repo` on the empty home page or in **Settings**, then open a PR. Choose **Analyze** to generate a guide. The app creates its local data files automatically; no `.env` file or database setup is required.

Keep the terminal running while you use the app. Ctrl-C stops any running analysis and then the server.

## Backend and local data

One local Node.js process runs the TanStack Start app and its server functions:

- `gh api` fetches PRs, diffs and conversations, and posts reviews or replies when you submit them.
- `codex exec` generates guides when you choose **Analyze** or **Re-analyze**. The app currently selects `gpt-6-luna` with high reasoning in `src/domain.ts` and `src/adapters.ts`.
- Node's built-in SQLite stores saved guides and pending comments in `.data/ryvu.db`. Repository settings live in `.data/settings.json`.

The CLIs are subprocesses of the app server. You do not run separate GitHub, Codex or database servers. Set `PR_GUIDE_DATA_DIR` to use a different data directory.

## Run the production build

```sh
pnpm build
pnpm start
```

Open **http://127.0.0.1:4317**. Run `pnpm build` again after changing the source. `just start` combines both commands.

Both servers bind only to `127.0.0.1`. Set `WEB_PORT` to change the development port or `PORT` to change the production port, for example `WEB_PORT=5174 pnpm dev` or `PORT=4318 pnpm start`.

## Development

`pnpm dev` runs Vite with TanStack Start. UI edits hot-reload in place, and an edit to a `src/*.functions.ts` file applies to the next call. An edit to any other server file directly in `src/` restarts the server's runtime. A running analysis stops, and an open page asks you to reload.

`pnpm typecheck` checks all sources. If you use `just`, run it without arguments to list its recipes.

## Use the app

The home page lists open PRs from your repositories through `gh`, with tabs for review requests, your own PRs and PRs with a cached guide, plus repository, author and draft filters. Press **⌘K** (Ctrl K elsewhere) to search: type to match titles, authors and `repo#number` (titles of older PRs are searched on GitHub as you type), or paste `1234`, `#1234`, `owner/repo#1234`, or any PR link including trailing paths such as `/changes?w=1`.

Opening a PR fetches it through `gh` without any model calls. **Analyze** sends its numbered snapshot hunks to Codex, which consumes normal account inference usage; ⇧↵ in search opens a PR's guide and analyzes it if needed. Guides are stored per head commit, so a PR is only analyzed again after new commits (or when you choose **Re-analyze**).

Revisiting a PR in the same tab shows its last loaded content immediately while refreshing it from GitHub. A full page reload clears this in-memory cache; saved analysis still remains in SQLite.

The four PR lists share their loaded rows. Switching tabs shows known matches immediately and fetches that list's remaining results in the background. New results are merged without duplicates using the same sort order. The sort choice is remembered in this browser across tabs, navigation and reloads.

**Reviewing:** hover a line number and click **+** to comment (drag across line numbers for a range). Comments stay pending in the local database until you open **Review** and submit them with Comment, Approve or Request changes. Replies to existing threads post immediately. These are the only GitHub writes, and they happen only when you submit.

## What it covers

- The PR list keeps four tabs visible. List options contains searchable repository and author filters, draft visibility, and sorting by update date, creation date or repository, with matching sections.

- The shadcn Sidebar keeps app navigation above the files on Overview, Guide and Diff. Repositories can collapse, and the file tree compacts nested folders and truncates only the last name. Drag the sidebar edge to resize it; double-click to reset. Search files with the magnifying glass or `/`; use the adjacent display button to switch between folders and diff order or hide matching files. Press `F` or `⌘B` / `Ctrl+B` to toggle the sidebar.
- Guide code blocks start expanded unless viewed. Diff and Guide keep separate expansion choices. Viewed state is shared between them and saved in this browser per PR and head commit; it does not sync with GitHub.
- Chapters organized around intent and behavior, with evidence highlighting and links to each section's files.
- Display settings, remembered in this browser: unified/split layout, hidden whitespace-only changes, line wrapping, word highlights, line numbers and code size. Diffs render through `@pierre/diffs`.
- Markdown file headers have an icon button to toggle preview. Preview reads the full file at the PR's head commit, renders Mermaid diagrams and highlights fenced code with the diff viewer's light/dark themes. Deleted files preview the base version. Raw HTML is skipped and images open as links.
- shadcn base-nova components backed by Base UI (buttons, checkbox, menus, popovers, dialog, switch).
- Analyzed guides and pending review comments are stored in SQLite at `.data/ryvu.db` (Node's built-in `node:sqlite`, no extra service). Guides from the earlier `.data/cache` files are imported when the server first opens the database.
- Settings (repositories, page size and default visibility) are stored in `.data/settings.json`. PR list responses are cached for 30 seconds, and loaded browser rows remain available until a full page reload.
- PR descriptions and comments render a safe Markdown subset (no raw HTML).
- Cancel an active generation; a newer request supersedes an earlier one for this browser session.
- Explicit limitations for missing/binary/partial patches; all changed files must be accounted for.
- Strict schema and exact hunk-range validation before a result is shown or cached.

## Boundaries

The app reads metadata, description and file patches, checking base/head SHAs before and after loading. Reading a PR fetches metadata, description, file patches, review threads and conversation comments. Expanding a hunk or opening a Markdown preview fetches full file contents at the snapshot's commit. It does not merge, edit issues or GitHub settings, publish or deploy. Marking a chapter read affects local progress only. Evidence validation establishes that referenced lines exist, not that every model explanation is correct. Independently review the code and explanations.

Limits: 200 files / 120,000 patch characters per guide. GitHub omissions and changed-file limits are surfaced. Generation has an eight-minute timeout, output limits and subprocess-group cancellation. Temporary generation files are removed. Codex runs ephemerally in a temporary directory with read-only sandbox, no approval prompts, ignored user config/rules, disabled hooks, shell, browser, apps, agents and memory features. Its authentication still comes from the existing Codex account. Only supplied snapshot data is intended to be analyzed.

The server answers only requests whose Host names its own 127.0.0.1 or localhost port, and refuses another Origin and cross-site requests. Server functions also pass TanStack Start's CSRF check and carry the session token the page gets when it opens. The server refuses request bodies over 256 KB. There is no general-purpose command or arbitrary URL endpoint; `gh` is only called with validated repository names and PR numbers. Its browser assets are built locally, including syntax grammars.

## Validation

`pnpm typecheck` checks all sources, and `pnpm build` builds the app and then type-checks it. `pnpm test:inbox` runs the inbox cache and ordering tests. To drive the real app in a browser and capture evidence, use the `verify-ryvu` skill in `.claude/skills/verify-ryvu/` (`SKILL.md` has the launch, doctor, drive and cleanup commands).
