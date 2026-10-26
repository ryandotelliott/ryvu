import { UserError } from './domain.js';
import { runCommand, type Runner } from './process.js';
import type { CommentThread, Conversation, DiffSide, DraftComment, PRIdentity, PullStack, PullStatus, ReviewComment, ReviewEvent, ReviewSummary } from './types.js';

const MAX_BODY = 65_536;
// GitHub explains rejected writes in a JSON body; surface that instead of a generic failure.
function githubError(action: string) {
  return (output: string) => {
    try {
      const data = JSON.parse(output);
      const details = [data.message, ...(Array.isArray(data.errors) ? data.errors.map((error: unknown) => typeof error === 'string' ? error : (error as Record<string, unknown>)?.message) : [])].filter(value => typeof value === 'string' && value);
      return details.length ? `GitHub couldn’t ${action}: ${details.join(' · ')}` : undefined;
    } catch { return undefined; }
  };
}
const route = (identity: PRIdentity) => `repos/${identity.owner}/${identity.repo}`;
function comment(raw: Record<string, any>): ReviewComment {
  return { id: Number(raw.id), author: String(raw.user?.login ?? 'ghost'), body: String(raw.body ?? ''), createdAt: String(raw.created_at ?? raw.submitted_at ?? ''), url: String(raw.html_url ?? '') };
}
const side = (value: unknown): DiffSide => value === 'LEFT' ? 'deletions' : 'additions';

const THREADS = 'query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { isResolved comments(first: 1) { nodes { databaseId } } } } } } }';
// The REST API doesn't say whether a thread is resolved; GraphQL does. Returns the ids of resolved threads' first comments.
async function resolvedThreads(identity: PRIdentity, signal: AbortSignal, runner: Runner): Promise<Set<number>> {
  const output = await runner('gh', ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${THREADS}`, '-f', `owner=${identity.owner}`, '-f', `name=${identity.repo}`, '-F', `number=${identity.number}`], { signal, maxBytes: 20_000_000 });
  const pages: Record<string, any>[] = JSON.parse(output);
  const ids = pages.flatMap(page => page?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []).filter(node => node?.isResolved).map(node => Number(node.comments?.nodes?.[0]?.databaseId));
  return new Set(ids.filter(Number.isInteger));
}

// Reads inline review threads, review summaries and the PR conversation. Read-only.
export async function fetchConversation(identity: PRIdentity, signal: AbortSignal, runner: Runner = runCommand): Promise<Conversation> {
  const pages = async (path: string): Promise<Record<string, any>[]> => {
    const value: unknown = JSON.parse(await runner('gh', ['api', `${path}?per_page=100`, '--paginate', '--slurp'], { signal, maxBytes: 20_000_000 }));
    return Array.isArray(value) ? (value as unknown[]).flat().filter(item => item && typeof item === 'object') as Record<string, any>[] : [];
  };
  const [inline, reviews, issue, resolved] = await Promise.all([pages(`${route(identity)}/pulls/${identity.number}/comments`), pages(`${route(identity)}/pulls/${identity.number}/reviews`), pages(`${route(identity)}/issues/${identity.number}/comments`), resolvedThreads(identity, signal, runner).catch(() => new Set<number>())]);
  const threads = new Map<number, CommentThread>();
  for (const raw of inline.filter(item => !item.in_reply_to_id)) {
    threads.set(Number(raw.id), { id: Number(raw.id), path: String(raw.path ?? ''), side: side(raw.side), line: Number.isInteger(raw.line) ? raw.line : null, startLine: Number.isInteger(raw.start_line) ? raw.start_line : null, originalLine: Number.isInteger(raw.original_line) ? raw.original_line : null, outdated: !Number.isInteger(raw.line), resolved: resolved.has(Number(raw.id)), comments: [comment(raw)] });
  }
  for (const raw of inline.filter(item => item.in_reply_to_id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) threads.get(Number(raw.in_reply_to_id))?.comments.push(comment(raw));
  const states = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'];
  const summaries: ReviewSummary[] = reviews.filter(raw => states.includes(raw.state) && (raw.state !== 'COMMENTED' || String(raw.body ?? '').trim()))
    .map(raw => ({ ...comment(raw), state: raw.state, submittedAt: String(raw.submitted_at ?? '') }));
  return { threads: [...threads.values()], reviews: summaries, comments: issue.map(comment) };
}

const STATUS = 'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { mergeStateStatus commits(last: 1) { totalCount nodes { commit { statusCheckRollup { state } } } } reviewRequests(first: 25) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Bot { login } ... on Mannequin { login } } } } } } }';
const MERGE: Record<string, PullStatus['merge']> = { BEHIND: 'behind', DIRTY: 'conflicts', BLOCKED: 'blocked', UNSTABLE: 'unstable', CLEAN: 'clean', HAS_HOOKS: 'clean' };
const CHECKS: Record<string, PullStatus['checks']> = { SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending' };
// Requested reviewers, the check rollup and how the branch stands against its base. Read-only.
export async function fetchStatus(identity: PRIdentity, signal: AbortSignal, runner: Runner = runCommand): Promise<PullStatus> {
  const output = await runner('gh', ['api', 'graphql', '-f', `query=${STATUS}`, '-f', `owner=${identity.owner}`, '-f', `name=${identity.repo}`, '-F', `number=${identity.number}`], { signal });
  const pull = JSON.parse(output)?.data?.repository?.pullRequest;
  if (!pull) throw new UserError('GitHub returned no pull request status.');
  const nodes: Record<string, any>[] = Array.isArray(pull.reviewRequests?.nodes) ? pull.reviewRequests.nodes : [];
  return {
    requested: nodes.map(node => node?.requestedReviewer).filter(Boolean).map(reviewer => ({ name: String(reviewer.login ?? reviewer.name ?? 'unknown'), team: reviewer.__typename === 'Team' })),
    checks: CHECKS[pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] ?? null,
    merge: MERGE[pull.mergeStateStatus] ?? null,
    commits: Number(pull.commits?.totalCount) || 0
  };
}

const STACKED = 'number title isDraft state additions deletions commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }';
// The stack this PR belongs to, or null when it isn't stacked. GitHub lists a stack bottom first. Read-only.
export async function fetchStack(identity: PRIdentity, signal: AbortSignal, runner: Runner = runCommand): Promise<PullStack | null> {
  const stacks: unknown = JSON.parse(await runner('gh', ['api', `${route(identity)}/stacks?pull_request=${identity.number}`], { signal }));
  const stack = Array.isArray(stacks) ? stacks[0] as Record<string, any> | undefined : undefined;
  const numbers: number[] = (Array.isArray(stack?.pull_requests) ? stack.pull_requests : []).map((pull: Record<string, any>) => Number(pull?.number)).filter((number: number) => Number.isSafeInteger(number) && number > 0);
  if (numbers.length < 2 || !numbers.includes(identity.number)) return null;
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${numbers.map((number, i) => `p${i}: pullRequest(number: ${number}) { ${STACKED} }`).join(' ')} } }`;
  const output = await runner('gh', ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${identity.owner}`, '-f', `name=${identity.repo}`], { signal });
  const repository: Record<string, any> = JSON.parse(output)?.data?.repository ?? {};
  const pulls = numbers.map((number, i) => {
    const raw: Record<string, any> = repository[`p${i}`] ?? {}, state = String(raw.state ?? 'OPEN').toLowerCase();
    return { number, title: String(raw.title ?? '').slice(0, 500), state: state === 'merged' || state === 'closed' ? state : 'open', draft: Boolean(raw.isDraft), additions: Number(raw.additions) || 0, deletions: Number(raw.deletions) || 0, checks: CHECKS[raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] ?? null } as const;
  });
  return { base: String(stack?.base?.ref ?? ''), pulls: pulls.reverse() };
}

export async function submitReview(identity: PRIdentity, headSHA: string, event: ReviewEvent, body: string, drafts: DraftComment[], runner: Runner = runCommand): Promise<void> {
  if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) throw new UserError('Choose comment, approve or request changes.', 400);
  if (body.length > MAX_BODY) throw new UserError('The review summary is too long.', 400);
  if (event === 'REQUEST_CHANGES' && !body.trim()) throw new UserError('Add a summary explaining the changes you’re requesting.', 400);
  if (event === 'COMMENT' && !body.trim() && !drafts.length) throw new UserError('Add a comment or a summary before submitting.', 400);
  const payload = {
    commit_id: headSHA, event, body,
    comments: drafts.map(draft => ({ path: draft.path, body: draft.body, line: draft.line, side: draft.side === 'deletions' ? 'LEFT' : 'RIGHT', ...(draft.startLine && draft.startLine < draft.line ? { start_line: draft.startLine, start_side: draft.side === 'deletions' ? 'LEFT' : 'RIGHT' } : {}) }))
  };
  await runner('gh', ['api', '--method', 'POST', `${route(identity)}/pulls/${identity.number}/reviews`, '--input', '-'], { signal: new AbortController().signal, input: JSON.stringify(payload), failureDetail: githubError('submit the review') });
}

export async function replyToThread(identity: PRIdentity, commentId: number, body: string, runner: Runner = runCommand): Promise<void> {
  if (!Number.isSafeInteger(commentId) || commentId < 1) throw new UserError('Unknown comment thread.', 400);
  if (!body.trim() || body.length > MAX_BODY) throw new UserError('Write a reply first.', 400);
  await runner('gh', ['api', '--method', 'POST', `${route(identity)}/pulls/${identity.number}/comments/${commentId}/replies`, '--input', '-'], { signal: new AbortController().signal, input: JSON.stringify({ body }), failureDetail: githubError('post the reply') });
}

// A file's text at one commit, for expanding the unchanged lines around a diff. Commits never change, so results are cached.
const fileCache = new Map<string, string>();
export async function fetchFile(owner: string, repo: string, sha: string, path: string, runner: Runner = runCommand): Promise<string> {
  if (!/^[a-f0-9]{40}$/.test(sha) || !path || path.length > 1000 || path.split('/').some(part => !part || part === '.' || part === '..')) throw new UserError('Invalid file request.', 400);
  const key = `${owner}/${repo}@${sha}:${path}`.toLowerCase(), cached = fileCache.get(key);
  if (cached !== undefined) return cached;
  const route = `repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`;
  const contents = await runner('gh', ['api', '-H', 'Accept: application/vnd.github.raw', route], { signal: new AbortController().signal, maxBytes: 5_000_000 });
  if (fileCache.size > 500) fileCache.delete(fileCache.keys().next().value!);
  fileCache.set(key, contents);
  return contents;
}
