import { randomUUID } from 'node:crypto';
import { assertSnapshotBudget, cacheKey, MODEL, parsePR, UserError, validateGuide } from './domain.js';
import { fetchCompare, fetchSnapshot, generateGuide } from './adapters.js';
import { fetchConversation, fetchStack, fetchStatus } from './github.js';
import type { Store } from './store.js';
import type { ChangedFile, Conversation, Guide, JobView, PRIdentity, PullDetail, PullStack, PullStatus, RangePull, Review, Snapshot } from './types.js';
export type Dependencies = { fetch: (identity: PRIdentity, signal: AbortSignal) => Promise<Snapshot>; generate: (snapshot: Snapshot, signal: AbortSignal, ignored: readonly string[]) => Promise<Guide>; conversation: (identity: PRIdentity, signal: AbortSignal) => Promise<Conversation>; status: (identity: PRIdentity, signal: AbortSignal) => Promise<PullStatus>; stack: (identity: PRIdentity, signal: AbortSignal) => Promise<PullStack | null>; compare: (identity: PRIdentity, base: string, head: string, signal: AbortSignal) => Promise<{ baseSHA: string; files: ChangedFile[] }> };
export class ReviewService {
  constructor(private store: Store, private deps: Dependencies = { fetch: fetchSnapshot, generate: generateGuide, conversation: fetchConversation, status: fetchStatus, stack: fetchStack, compare: fetchCompare }) {}
  // A stored guide for this head commit, if it still matches the current diff.
  cached(snapshot: Snapshot): Review | null {
    const review = this.store.guide(`${snapshot.identity.owner}/${snapshot.identity.repo}`, snapshot.identity.number, snapshot.headSHA);
    if (!review) return null;
    try { return { ...review, guide: validateGuide(review.guide, snapshot, review.ignored), snapshot, cached: true }; } catch { return null; }
  }
  // Everything needed to read a PR without running analysis.
  async detail(identity: PRIdentity, viewer: Promise<string>, signal: AbortSignal): Promise<PullDetail> {
    // The status panel and the stack are optional, so their failure leaves the rest of the page readable.
    const [snapshot, conversation, login, status, stack] = await Promise.all([this.deps.fetch(identity, signal), this.deps.conversation(identity, signal), viewer.catch(() => ''), this.deps.status(identity, signal).catch(() => null), this.deps.stack(identity, signal).catch(() => null)]);
    const repo = `${identity.owner}/${identity.repo}`, guide = this.cached(snapshot);
    return { snapshot, guide, prior: guide ? null : this.store.priorGuide(repo, identity.number, snapshot.headSHA), conversation, drafts: this.store.drafts(repo, identity.number), viewer: login, status, stack, range: null };
  }
  // The PRs of one stack from this PR to `through`, read as one diff from the bottom PR's base to the top PR's head.
  // The diff is shaped like the opened PR's snapshot so the Diff page reads it unchanged. Ranges have no guide or comments.
  async range(identity: PRIdentity, through: number, viewer: Promise<string>, signal: AbortSignal): Promise<PullDetail> {
    const stack = await this.deps.stack(identity, signal).catch(() => null);
    const ends = [identity.number, through].map(number => stack?.pulls.findIndex(pull => pull.number === number) ?? -1);
    if (!stack || ends.includes(-1)) throw new UserError(`#${through} isn’t in the same stack as #${identity.number}.`);
    const pulls = stack.pulls.slice(Math.min(...ends), Math.max(...ends) + 1);
    const [snapshots, login] = await Promise.all([Promise.all(pulls.map(pull => this.deps.fetch({ ...identity, number: pull.number, url: `https://github.com/${identity.owner}/${identity.repo}/pull/${pull.number}` }, signal))), viewer.catch(() => '')]);
    const top = snapshots[0], bottom = snapshots[snapshots.length - 1];
    const diff = await this.deps.compare(identity, bottom.baseSHA, top.headSHA, signal);
    const snapshot: Snapshot = { ...top, identity, body: '', baseSHA: diff.baseSHA, baseRef: bottom.baseRef, files: diff.files, warnings: [], fetchedAt: new Date().toISOString() };
    const range: RangePull[] = pulls.map((pull, i) => ({ ...pull, author: snapshots[i].author, body: snapshots[i].body, baseRef: snapshots[i].baseRef ?? '', headRef: snapshots[i].headRef ?? '', files: [...new Set(snapshots[i].files.flatMap(file => file.previousPath ? [file.path, file.previousPath] : [file.path]))] }));
    return { snapshot, guide: null, prior: null, conversation: { threads: [], reviews: [], comments: [] }, drafts: [], viewer: login, status: null, stack, range };
  }
  // `requested` are paths the reviewer hid; they are left out of what the model sees and recorded on the guide.
  async review(input: unknown, signal: AbortSignal, update: (state: 'loading' | 'generating', message: string) => void, fresh = false, requested: readonly string[] = []): Promise<Review> {
    const identity = parsePR(input); update('loading', 'Reading the pull request’s current diff…');
    const snapshot = await this.deps.fetch(identity, signal); signal.throwIfAborted();
    const ignored = snapshot.files.map(file => file.path).filter(path => requested.includes(path));
    const analyzed: Snapshot = { ...snapshot, files: snapshot.files.filter(file => !ignored.includes(file.path)), warnings: snapshot.warnings.filter(warning => !ignored.some(path => warning.startsWith(`${path}:`))) };
    assertSnapshotBudget(analyzed);
    // A stored guide is reused only if it ignored the same files.
    const cached = fresh ? null : this.cached(snapshot);
    if (cached && sameFiles(cached.ignored ?? [], ignored)) return cached;
    update('generating', `Organizing ${analyzed.files.length} changed files into a guide with GPT-6 Luna…`);
    const generated = validateGuide(await this.deps.generate(analyzed, signal, ignored), analyzed); signal.throwIfAborted();
    const guide = ignored.length ? { ...generated, limitations: [...generated.limitations, ignoredNote(ignored)] } : generated;
    const result: Review = { snapshot, guide, key: cacheKey(snapshot), model: MODEL, generatedAt: new Date().toISOString(), cached: false, ignored };
    this.store.saveGuide(result);
    return result;
  }
}
const sameFiles = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(path => b.includes(path));
function ignoredNote(ignored: readonly string[]) {
  const shown = ignored.slice(0, 10).join(', '), more = ignored.length > 10 ? ` and ${ignored.length - 10} more` : '';
  return `${ignored.length} ${ignored.length === 1 ? 'file was' : 'files were'} ignored for this review because your file filters hide ${ignored.length === 1 ? 'it' : 'them'}: ${shown}${more}.`;
}
type Job = { view: JobView; abort: AbortController; clientId: string; created: number };
export class Jobs {
  private jobs = new Map<string, Job>(); private clients = new Map<string, { sequence: number; jobId: string }>(); private running = new Set<Promise<void>>(); private closed = false;
  constructor(private service: ReviewService) {}
  start(clientId: unknown, sequence: unknown, input: unknown, fresh: unknown = false, ignored: unknown = []): JobView {
    if (this.closed) throw new UserError('The local server is shutting down.', 503);
    if (typeof clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(clientId) || !Number.isSafeInteger(sequence) || Number(sequence) < 1 || typeof fresh !== 'boolean') throw new UserError('Invalid request identity.', 400);
    if (!Array.isArray(ignored) || ignored.length > 3000 || ignored.some(path => typeof path !== 'string' || path.length > 1000)) throw new UserError('Invalid list of ignored files.', 400);
    const previous = this.clients.get(clientId);
    if (previous && previous.sequence >= Number(sequence)) throw new UserError('A newer request already exists.', 409);
    parsePR(input);
    for (const [id, job] of this.jobs) if (Date.now() - job.created > 30 * 60_000 && !['loading', 'generating'].includes(job.view.state)) this.jobs.delete(id);
    if (this.jobs.size >= 50 || (!previous && this.clients.size >= 50)) throw new UserError('Too many sessions. Restart the local server.', 429);
    if (previous) this.cancel(previous.jobId, clientId);
    const id = randomUUID(), job: Job = { view: { id, state: 'loading', message: 'Reading pull request…' }, abort: new AbortController(), clientId, created: Date.now() };
    this.jobs.set(id, job); this.clients.set(clientId, { sequence: Number(sequence), jobId: id });
    const task = (async () => {
      try {
        const result = await this.service.review(input, job.abort.signal, (state, message) => { if (!job.abort.signal.aborted) job.view = { id, state, message }; }, fresh, ignored as string[]);
        job.abort.signal.throwIfAborted(); job.view = { id, state: 'complete', message: 'Your guide is ready.', result };
      } catch (error) {
        if (job.abort.signal.aborted) job.view = { id, state: 'cancelled', message: 'Generation cancelled.' };
        else job.view = { id, state: 'failed', message: 'Guide could not be generated.', error: error instanceof UserError ? error.message : 'Unexpected response. Check the local server and retry.' };
      }
    })();
    this.running.add(task); void task.finally(() => this.running.delete(task));
    return job.view;
  }
  get(id: string): JobView { const job = this.jobs.get(id); if (!job) throw new UserError('This job expired or the server restarted. Start again.', 404); return job.view; }
  cancel(id: string, clientId: unknown): JobView {
    const job = this.jobs.get(id); if (!job || job.clientId !== clientId) throw new UserError('Job not found.', 404);
    if (['loading', 'generating'].includes(job.view.state)) { job.abort.abort(); job.view = { id, state: 'cancelled', message: 'Generation cancelled.' }; }
    return job.view;
  }
  async close(): Promise<void> { this.closed = true; for (const job of this.jobs.values()) job.abort.abort(); await Promise.all(this.running); }
}
