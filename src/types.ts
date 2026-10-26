export type PRIdentity = { owner: string; repo: string; number: number; url: string };
export type DiffLine = { kind: 'add' | 'remove' | 'context'; text: string; oldLine: number | null; newLine: number | null; hunk: number };
export type ChangedFile = { path: string; previousPath: string | null; status: string; additions: number; deletions: number; patch: string | null; availability: 'complete' | 'unavailable' | 'partial'; lines: DiffLine[] };
export type Snapshot = { identity: PRIdentity; title: string; body: string; author: string; baseSHA: string; headSHA: string; fetchedAt: string; warnings: string[]; files: ChangedFile[]; headRef?: string; baseRef?: string; state?: 'open' | 'closed' | 'merged'; draft?: boolean; createdAt?: string };
export type Reference = { path: string; side: 'old' | 'new'; startLine: number; endLine: number };
export type Chapter = { id: string; title: string; purpose: string; behavior: string; questions: string[]; files: string[]; references: Reference[] };
export type Guide = { summary: string; chapters: Chapter[]; omissions: { path: string; reason: string }[]; limitations: string[] };
// `ignored` lists files the reviewer hid; they were left out of the analysis.
export type Review = { snapshot: Snapshot; guide: Guide; key: string; model: string; generatedAt: string; cached: boolean; ignored?: string[] };
export type JobView = { id: string; state: 'loading' | 'generating' | 'complete' | 'failed' | 'cancelled'; message: string; result?: Review; error?: string };
export type GuideStatus = { key: string; chapters: number };
export type PullSummary = { repo: string; number: number; title: string; author: string; authorIsBot: boolean; isDraft: boolean; state: 'open' | 'closed' | 'merged'; createdAt: string; updatedAt: string; additions: number; deletions: number; branch: string; url: string; reviewRequested: boolean; mine: boolean; guide: GuideStatus | null };
// A search-palette entry: just enough to find and open a PR.
export type IndexedPull = Pick<PullSummary, 'repo' | 'number' | 'title' | 'author'>;
export type Settings = { repos: string[]; pageSize: 10 | 25 | 50; showDrafts: boolean; showBots: boolean };
export type PullTab = 'all' | 'review' | 'mine' | 'guides';
export type PullSort = 'updated' | 'created' | 'repo';
export type PullFilters = { tab?: string; repo?: string; author?: string; drafts?: string; sort?: string };
export type PullQuery = PullFilters & { after?: string; refresh?: boolean };
export type PullRef = { repo: string; number: number };
// One page of the home list. Counts and per-repository totals come with the first page only.
export type PullPage = { items: PullSummary[]; total: number; cursor: string | null; counts: Record<PullTab, number> | null; repos: { repo: string; open: number; review: number }[] | null; errors: { repo: string; message: string }[] };
export type Resolution = { kind: 'none' | 'link' | 'number'; items: PullSummary[]; error?: string };
export type DiffSide = 'additions' | 'deletions';
export type ReviewComment = { id: number; author: string; body: string; createdAt: string; url: string };
export type CommentThread = { id: number; path: string; side: DiffSide; line: number | null; startLine: number | null; originalLine: number | null; outdated: boolean; resolved: boolean; comments: ReviewComment[] };
export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
export type ReviewSummary = { id: number; author: string; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'; body: string; submittedAt: string; url: string };
export type Conversation = { threads: CommentThread[]; reviews: ReviewSummary[]; comments: ReviewComment[] };
export type DraftComment = { id: string; path: string; side: DiffSide; startLine: number | null; line: number; body: string; headSHA: string; createdAt: string };
export type PriorGuide = { headSHA: string; generatedAt: string };
// Live review state beside the description. It changes without new commits, so it is never stored with a guide.
export type PullStatus = { requested: { name: string; team: boolean }[]; checks: 'success' | 'failure' | 'pending' | null; merge: 'behind' | 'conflicts' | 'blocked' | 'unstable' | 'clean' | null; commits: number };
export type StackedPull = { number: number; title: string; state: 'open' | 'closed' | 'merged'; draft: boolean; additions: number; deletions: number; checks: PullStatus['checks'] };
// PRs that build on each other, from GitHub's stacked pull requests. `pulls` runs from the top of the stack down to the PR that merges into `base`.
export type PullStack = { base: string; pulls: StackedPull[] };
// One PR of a range reviewed together, with the paths it changed (old paths of renames included).
export type RangePull = StackedPull & { author: string; body: string; baseRef: string; headRef: string; files: string[] };
// `range` is set when the page shows several PRs of one stack as one diff. It runs top first, like `PullStack.pulls`.
export type PullDetail = { snapshot: Snapshot; guide: Review | null; prior: PriorGuide | null; conversation: Conversation; drafts: DraftComment[]; viewer: string; status: PullStatus | null; stack: PullStack | null; range: RangePull[] | null };
