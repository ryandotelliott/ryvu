import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Inbox } from '../src/pulls.js';
import { Store } from '../src/store.js';
import { groupPulls } from '../src/web/home-groups.js';
import { InboxCache } from '../src/web/inbox-cache.js';
import type { Runner } from '../src/process.js';
import type { PullPage, PullQuery, PullSummary, Settings } from '../src/types.js';

function pull(number: number, at: Date, repo = 'org/a'): PullSummary {
  return { repo, number, title: `Pull ${number}`, author: 'alice', authorIsBot: false, isDraft: false, state: 'open', createdAt: at.toISOString(), updatedAt: at.toISOString(), additions: 1, deletions: 0, branch: 'main', url: `https://github.com/${repo}/pull/${number}`, reviewRequested: false, mine: true, guide: null };
}

test('date sections use local calendar boundaries, including a DST change', () => {
  process.env.TZ = 'America/New_York';
  const now = new Date(2026, 2, 9, 12).getTime();
  const days = [0, 1, 2, 6, 7, 29, 30];
  const items = days.map((day, index) => pull(index, new Date(2026, 2, 9 - day, 0)));
  const groups = groupPulls(items, 'updated', now);
  assert.deepEqual(groups.map(group => [group.key, group.items.map(pull => pull.number)]), [
    ['today', [0]], ['yesterday', [1]], ['week', [2, 3]], ['month', [4, 5]], ['older', [6]]
  ]);
  assert.equal(groups[0].title, 'Updated today');
  const created = groupPulls(items.map(item => ({ ...item, updatedAt: new Date(now).toISOString() })), 'created', now);
  assert.deepEqual(created.map(group => group.items.map(pull => pull.number)), groups.map(group => group.items.map(pull => pull.number)));
  assert.equal(created[0].title, 'Created today');
});

test('repository sections are alphabetical and do not duplicate their rows', () => {
  const items = [pull(1, new Date(), 'org/z'), pull(2, new Date(), 'org/a'), pull(3, new Date(), 'org/z')];
  assert.deepEqual(groupPulls(items, 'repo', Date.now()).map(group => [group.title, group.items.map(pull => pull.number)]), [['org/a', [2]], ['org/z', [1, 3]]]);
});

const fixtures = ['org/a', 'org/b'].flatMap((repo, ri) => Array.from({ length: ri ? 12 : 13 }, (_, i) => ({
  ...pull(ri * 100 + i + 1, new Date(Date.UTC(2026, 0, 25 - i)), repo),
  author: i % 2 ? 'bob' : 'alice', isDraft: i % 3 === 0, reviewRequested: i % 2 === 0
})));

const runner: Runner = async (_command, args, options) => {
  if (args.includes('user')) return 'alice';
  const query: string = JSON.parse(options.input ?? '{}').query;
  const data: Record<string, unknown> = {};
  const search = /(\w+): search\(query: ("(?:\\.|[^"\\])*"), type: ISSUE, first: (\d+)(?:, after: ("(?:\\.|[^"\\])*"))?\)/g;
  for (const match of query.matchAll(search)) {
    const terms: string = JSON.parse(match[2]);
    const repos = [...terms.matchAll(/repo:([\w/-]+)/g)].map(match => match[1]);
    let items = fixtures.filter(item => repos.includes(item.repo));
    if (terms.includes('author:alice') || terms.includes('author:@me')) items = items.filter(item => item.author === 'alice');
    if (terms.includes('draft:false')) items = items.filter(item => !item.isDraft);
    if (terms.includes('review-requested:@me')) items = items.filter(item => item.reviewRequested);
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const offset = match[4] ? Number(JSON.parse(match[4]).slice(1)) : 0, size = Number(match[3]);
    const nodes = items.slice(offset, offset + size).map(item => ({ ...item, state: 'OPEN', headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), headRefName: 'branch', author: { __typename: 'User', login: item.author }, repository: { nameWithOwner: item.repo }, reviewRequests: { nodes: [] } }));
    data[match[1]] = { issueCount: items.length, nodes, pageInfo: { hasNextPage: offset + size < items.length, endCursor: `c${offset + size}` } };
  }
  return JSON.stringify({ data });
};

async function withInbox(run: (inbox: Inbox, settings: Settings) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'ryvu-inbox-test-')), store = new Store(join(directory, 'test.db'));
  try { await run(new Inbox(store, runner), { repos: ['org/b', 'org/empty', 'org/a'], pageSize: 10, showDrafts: true, showBots: true }); }
  finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}

async function collect(inbox: Inbox, settings: Settings, query: PullQuery) {
  const pages = [];
  let after: string | undefined;
  do {
    const page = await inbox.page(settings, { ...query, after }); pages.push(page); after = page.cursor ?? undefined;
    assert.ok(pages.length < 10, 'pagination makes progress');
  } while (after);
  return pages;
}

test('repository pagination fills pages across repositories without gaps or duplicates', async () => {
  await withInbox(async (inbox, settings) => {
    const pages = await collect(inbox, settings, { sort: 'repo' });
    assert.deepEqual(pages.map(page => page.items.length), [10, 10, 5]);
    assert.equal(pages[0].total, 25); assert.equal(pages[2].total, 25);
    assert.deepEqual(pages[1].items.map(item => item.repo), ['org/a', 'org/a', 'org/a', ...Array(7).fill('org/b')]);
    const items = pages.flatMap(page => page.items);
    assert.deepEqual(items.map(item => item.url), [...fixtures].sort((a, b) => a.repo.localeCompare(b.repo) || b.updatedAt.localeCompare(a.updatedAt)).map(item => item.url));
    assert.equal(new Set(items.map(item => item.url)).size, 25);
  });
});

test('repository sorting preserves author, draft and review filters', async () => {
  await withInbox(async (inbox, settings) => {
    const pages = await collect(inbox, settings, { sort: 'repo', author: 'alice', drafts: 'hidden', tab: 'review' });
    const items = pages.flatMap(page => page.items), expected = fixtures.filter(item => item.author === 'alice' && !item.isDraft && item.reviewRequested);
    assert.deepEqual(items.map(item => item.url), expected.map(item => item.url));
    assert.ok(items.every(item => item.reviewRequested));
    assert.equal(pages[0].counts?.review, expected.length);
    await assert.rejects(inbox.page(settings, { sort: 'repo', after: 'repo:99:' }), /Invalid page cursor/);
    await assert.rejects(inbox.page(settings, { sort: 'repo', after: 'garbage' }), /Invalid page cursor/);
  });
});

const cacheSettings: Settings = { repos: ['org/a', 'org/b'], pageSize: 10, showDrafts: true, showBots: true };
function cachedPage(items: PullSummary[], cursor: string | null = null): PullPage {
  return { items, cursor, total: 20, counts: { all: 20, mine: 10, review: 5, guides: 3 }, repos: [{ repo: 'org/a', open: 20, review: 5 }], errors: [] };
}
function pendingCache() {
  const requests: { query: PullQuery; resolve: (page: PullPage) => void; reject: (error: Error) => void }[] = [];
  const cache = new InboxCache(query => new Promise((resolve, reject) => requests.push({ query, resolve, reject })));
  return { cache, requests };
}

test('tabs immediately derive partial matches, then merge and sort pages without duplicates', async () => {
  const { cache, requests } = pendingCache();
  const a = { ...pull(1, new Date('2026-01-01')), guide: { key: 'a', chapters: 1 }, reviewRequested: true };
  const b = { ...pull(2, new Date('2026-01-03')), mine: false };
  const c = pull(3, new Date('2026-01-02'));
  const initial = cache.load(cacheSettings, {});
  requests[0].resolve(cachedPage([b, a], 'next-all')); await initial;
  assert.deepEqual(cache.read(cacheSettings, { tab: 'mine' }).items.map(p => p.number), [1]);
  assert.deepEqual(cache.read(cacheSettings, { tab: 'review' }).items.map(p => p.number), [1]);
  assert.deepEqual(cache.read(cacheSettings, { tab: 'guides' }).items.map(p => p.number), [1]);
  assert.equal(cache.read(cacheSettings, { tab: 'mine' }).complete, false);
  const mine = cache.load(cacheSettings, { tab: 'mine' });
  assert.equal(cache.load(cacheSettings, { tab: 'mine' }), mine, 'concurrent callers share the same request');
  assert.equal(cache.read(cacheSettings, { tab: 'mine' }).loading, true);
  requests[1].resolve(cachedPage([c, a], 'next-mine')); await mine;
  assert.deepEqual(cache.read(cacheSettings, { tab: 'mine' }).items.map(p => p.number), [3, 1]);
  assert.deepEqual(cache.read(cacheSettings, {}).items.map(p => p.number), [2, 3, 1]);
  const more = cache.load(cacheSettings, { tab: 'mine' }, { more: true });
  assert.equal(requests[2].query.after, 'next-mine');
  requests[2].resolve(cachedPage([a], null)); await more;
  assert.deepEqual(cache.read(cacheSettings, { tab: 'mine' }).items.map(p => p.number), [3, 1]);
  assert.equal(cache.read(cacheSettings, { tab: 'mine' }).complete, true);
  await cache.load(cacheSettings, { tab: 'mine' });
  assert.equal(requests.length, 3, 'fresh revisits do not refetch');
});

test('cached rows respect filters and use the same tie breakers across tabs and sort modes', async () => {
  const { cache, requests } = pendingCache();
  const a = pull(1, new Date('2026-01-01'), 'org/b');
  const b = { ...pull(2, new Date('2026-01-02')), createdAt: '2025-01-01T00:00:00.000Z' };
  const c = { ...pull(3, new Date('2026-01-02')), isDraft: true };
  const d = { ...pull(4, new Date('2026-01-04')), authorIsBot: true, author: 'bot[bot]', mine: false };
  const initial = cache.load(cacheSettings, {});
  requests[0].resolve(cachedPage([a, b, c, d])); await initial;
  assert.deepEqual(cache.read(cacheSettings, { tab: 'mine' }).items.map(p => p.number), [3, 2, 1]);
  assert.deepEqual(cache.read(cacheSettings, { sort: 'created' }).items.map(p => p.number), [4, 3, 1, 2]);
  assert.deepEqual(cache.read(cacheSettings, { sort: 'repo' }).items.map(p => p.number), [4, 3, 2, 1]);
  assert.deepEqual(cache.read(cacheSettings, { tab: 'mine', drafts: 'hidden', repo: 'org/a' }).items.map(p => p.number), [2]);
  assert.equal(cache.read({ ...cacheSettings, showBots: false }, {}).items.length, 0, 'new settings never expose the old scope');
});

test('late responses cannot overwrite newer rows, counts, or a changed repository scope', async () => {
  const { cache, requests } = pendingCache();
  const old = cache.load(cacheSettings, {});
  const recent = cache.load(cacheSettings, { tab: 'mine' });
  requests[1].resolve({ ...cachedPage([pull(1, new Date('2026-01-02'))]), counts: { all: 21, mine: 11, review: 5, guides: 3 } }); await recent;
  requests[0].resolve(cachedPage([pull(1, new Date('2026-01-01'))])); await old;
  assert.equal(cache.read(cacheSettings, {}).items[0].updatedAt, '2026-01-02T00:00:00.000Z');
  assert.equal(cache.read(cacheSettings, {}).counts?.all, 21);
  const stale = cache.load(cacheSettings, {}, { force: true });
  const settings = { ...cacheSettings, repos: ['org/b'] };
  const changed = cache.load(settings, {});
  requests[3].resolve(cachedPage([pull(2, new Date(), 'org/b')])); await changed;
  requests[2].resolve(cachedPage([pull(1, new Date())])); await stale;
  assert.deepEqual(cache.read(settings, {}).items.map(p => p.repo), ['org/b']);
});

test('failed pagination preserves cached rows and retries the same cursor', async () => {
  const { cache, requests } = pendingCache();
  const initial = cache.load(cacheSettings, {});
  requests[0].resolve(cachedPage([pull(1, new Date())], 'next')); await initial;
  const more = cache.load(cacheSettings, {}, { more: true });
  requests[1].reject(new Error('temporary failure')); await more;
  const view = cache.read(cacheSettings, {});
  assert.equal(view.items.length, 1); assert.equal(view.error, 'temporary failure'); assert.equal(view.failedMore, true);
  const retry = cache.load(cacheSettings, {}, { more: view.failedMore, force: true });
  assert.equal(requests[2].query.after, 'next');
  requests[2].resolve(cachedPage([pull(2, new Date())])); await retry;
  assert.equal(cache.read(cacheSettings, {}).items.length, 2);
});

test('a complete refresh drops stale rows while newer results can populate another completed tab', async () => {
  const { cache, requests } = pendingCache();
  const initial = cache.load(cacheSettings, {});
  requests[0].resolve(cachedPage([pull(1, new Date())])); await initial;
  const mine = cache.load(cacheSettings, { tab: 'mine' });
  requests[1].resolve(cachedPage([pull(2, new Date())])); await mine;
  assert.equal(cache.read(cacheSettings, {}).items.length, 2);
  const refresh = cache.load(cacheSettings, {}, { force: true });
  requests[2].resolve(cachedPage([pull(2, new Date())])); await refresh;
  assert.deepEqual(cache.read(cacheSettings, {}).items.map(p => p.number), [2]);
});
