
function pullFiles(ctx, pull) {
  return ctx.github(`repos/${pull.repo}/pulls/${pull.number}/files?per_page=100`).map(file => ({
    path: file.filename, patched: typeof file.patch === 'string',
    added: (file.patch ?? '').split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1))
  }));
}

export async function pickLargePull(ctx) {
  const pulls = await ctx.inbox();
  ctx.check(pulls.length > 0, `the seeded inbox lists pull requests (${pulls.length})`);
  const pull = [...pulls].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))[0];
  const files = pullFiles(ctx, pull);
  ctx.note(`picked ${pull.repo}#${pull.number} "${pull.title}" (${files.length} files, +${pull.additions} −${pull.deletions})`);
  return { pull, files, path: pull.path };
}

const THREADS = 'query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { isResolved comments(first: 1) { nodes { databaseId } } } } } } }';
function openThreads(ctx, pull) {
  const [owner, name] = pull.repo.split('/');
  const resolved = new Set(ctx.githubQuery(THREADS, { owner, name, number: pull.number }).flatMap(page => page.data.repository.pullRequest.reviewThreads.nodes).filter(node => node.isResolved).map(node => node.comments.nodes[0]?.databaseId));
  const patched = new Set(pullFiles(ctx, pull).filter(file => file.patched).map(file => file.path));
  return ctx.github(`repos/${pull.repo}/pulls/${pull.number}/comments?per_page=100`).filter(comment => !comment.in_reply_to_id && Number.isInteger(comment.line) && !resolved.has(comment.id)).map(comment => ({ ...comment, drawn: patched.has(comment.path) }));
}

export async function pickPullWithOpenThread(ctx, limit = 10) {
  const pulls = await ctx.inbox();
  for (const pull of pulls.slice(0, limit)) {
    const open = openThreads(ctx, pull);
    if (open.length && open.every(thread => thread.drawn)) { ctx.note(`picked ${pull.repo}#${pull.number} with ${open.length} open threads`); return { pull, open, path: pull.path }; }
  }
  throw new Error(`none of the first ${limit} inbox PRs has open comment threads on current lines, all in files with a patch`);
}
