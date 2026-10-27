import { createServerFn } from '@tanstack/react-start';
import { fields, parsePR, parseRepo, UserError } from './domain.js';
import { fetchConversation, fetchFile, replyToThread as postReply, submitReview as postReview } from './github.js';
import { runtime } from './runtime.server';
import type { DiffSide, DraftComment, PRIdentity, PullRef, ReviewEvent } from './types.js';

const MAX_BODY = 65_536;
const pullFrom = (raw: Record<string, unknown>): PRIdentity => parsePR(`https://github.com/${parseRepo(raw.repo)}/pull/${Number(raw.number)}`);
const repoName = (pull: PRIdentity) => `${pull.owner}/${pull.repo}`;
function lineNumber(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new UserError(`Invalid ${name}.`, 400); return Number(value); }
function text(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim() || value.length > MAX_BODY) throw new UserError(`Write a ${name} first.`, 400); return value; }
function draftId(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new UserError('That pending comment no longer exists.', 404); return value; }
const isHeadSHA = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const sides: DiffSide[] = ['additions', 'deletions'], events: ReviewEvent[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'];

export const getPull = createServerFn({ method: 'GET' })
  .validator((input: PullRef) => pullFrom(fields(input)))
  .handler(({ data }) => { const { service, inbox } = runtime(); return service.detail(data, inbox.login(), new AbortController().signal); });

export const getRange = createServerFn({ method: 'GET' })
  .validator((input: PullRef & { through: number }) => {
    const raw = fields(input), pull = pullFrom(raw);
    if (!Number.isSafeInteger(raw.through) || Number(raw.through) < 1 || raw.through === pull.number) throw new UserError('Pick another pull request from the stack.', 400);
    return { pull, through: Number(raw.through) };
  })
  .handler(({ data }) => { const { service, inbox } = runtime(); return service.range(data.pull, data.through, inbox.login(), new AbortController().signal); });

export const readFile = createServerFn({ method: 'GET' })
  .validator((input: { repo: string; sha: string; path: string }) => {
    const raw = fields(input), [owner, repo] = parseRepo(raw.repo).split('/');
    return { owner, repo, sha: typeof raw.sha === 'string' ? raw.sha : '', path: typeof raw.path === 'string' ? raw.path : '' };
  })
  .handler(({ data }) => fetchFile(data.owner, data.repo, data.sha, data.path));

// A null `line` comments on the whole file.
type NewDraft = PullRef & Pick<DraftComment, 'headSHA' | 'path' | 'side' | 'startLine' | 'line' | 'body'>;
export const addDraft = createServerFn({ method: 'POST' })
  .validator((input: NewDraft) => {
    const raw = fields(input), pull = pullFrom(raw), line = raw.line === null ? null : lineNumber(raw.line, 'line');
    const startLine = raw.startLine === null || raw.startLine === undefined || line === null ? null : lineNumber(raw.startLine, 'start line');
    const side = sides.find(value => value === raw.side);
    if (typeof raw.path !== 'string' || !raw.path || raw.path.length > 1000 || !side || !isHeadSHA(raw.headSHA) || (startLine !== null && line !== null && startLine > line)) throw new UserError('Invalid comment position.', 400);
    return { pull, draft: { headSHA: raw.headSHA, path: raw.path, side, startLine: startLine === line ? null : startLine, line, body: text(raw.body, 'comment') } };
  })
  .handler(({ data }) => runtime().store.addDraft(repoName(data.pull), data.pull.number, data.draft));

export const updateDraft = createServerFn({ method: 'POST' })
  .validator((input: { id: string; body: string }) => { const raw = fields(input); return { id: draftId(raw.id), body: text(raw.body, 'comment') }; })
  .handler(({ data }) => runtime().store.updateDraft(data.id, data.body));

export const deleteDraft = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => draftId(fields(input).id))
  .handler(({ data }) => { runtime().store.deleteDraft(data); });

export const submitReview = createServerFn({ method: 'POST' })
  .validator((input: PullRef & { headSHA: string; event: ReviewEvent; body: string }) => {
    const raw = fields(input);
    const event = events.find(value => value === raw.event);
    if (!isHeadSHA(raw.headSHA) || !event || typeof raw.body !== 'string') throw new UserError('Invalid review.', 400);
    return { pull: pullFrom(raw), headSHA: raw.headSHA, event, body: raw.body };
  })
  .handler(async ({ data }) => {
    const { store } = runtime(), { pull } = data, drafts = store.drafts(repoName(pull), pull.number);
    await postReview(pull, data.headSHA, data.event, data.body, drafts);
    store.clearDrafts(repoName(pull), pull.number, drafts.map(item => item.id));
    return { conversation: await fetchConversation(pull, new AbortController().signal), drafts: store.drafts(repoName(pull), pull.number) };
  });

export const replyToThread = createServerFn({ method: 'POST' })
  .validator((input: PullRef & { commentId: number; body: string }) => { const raw = fields(input); return { pull: pullFrom(raw), commentId: Number(raw.commentId), body: text(raw.body, 'reply') }; })
  .handler(async ({ data }) => {
    await postReply(data.pull, data.commentId, data.body);
    return fetchConversation(data.pull, new AbortController().signal);
  });
