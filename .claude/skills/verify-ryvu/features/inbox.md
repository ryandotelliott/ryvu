# Inbox and ⌘K

The home page lists open pull requests across the user's repositories, with tabs for all, review requested, authored and guide-ready PRs. ⌘K opens a palette that searches PRs by title and opens one; clicking a row opens that PR's Overview.

## Sub-features

- `inbox-list` shows open PRs from the seeded repositories, newest activity first.
- `inbox-tabs` switches between All open, Review requested, Authored by me and Guide ready.
- `palette-search` finds a PR by words from its title.
- `inbox-open` opens a row on the PR's Overview page.

## How to get to it (user POV)

- Open `/` (the app's start page); the sidebar's "Pull requests" link returns there.
- Press ⌘K (Ctrl+K) anywhere, or click "Find a pull request" in the sidebar.
- Click a tab above the list; each is a link with `?tab=review|mine|guides`.

## Driving it with Playwright

Preconditions:

- Seeded settings list at least one repository with open PRs.

- **List loads.** Open `/`. `go('/')`, then wait for `a.pull-row:not(.skeleton)`. At least one row shows with a `.pull-title`.
- **Palette search.** Press `Meta+k`, fill the input with placeholder `Search pull requests, or paste a link or number` with three words from the first row's title. An option whose name contains that title appears.
- **Open a PR.** Press Escape, click the first row. The URL becomes `/pr/<owner>/<repo>/<n>`, `.pr-heading h1` equals the row's title, and the `Overview` tab has `aria-current="page"`.
- **Proof.** Screenshots of the list, the palette with the match, and the Overview.

## Gotchas

- Rows render as `.pull-row.skeleton` placeholders first; wait for non-skeleton rows.
- The list comes from live GitHub search and changes between runs; choose rows at run time, never by number.
- GitHub search can briefly return nothing; the app retries, so allow up to a minute for the first load.
- With no seeded repositories the page shows an empty state and every journey that needs a PR fails.
