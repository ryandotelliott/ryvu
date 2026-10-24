import { fields, parseReference, parseRepo, UserError } from './domain.js';
import type { Store } from './store.js';
import { runCommand, type Runner } from './process.js';
import type { GuideStatus, IndexedPull, PullPage, PullQuery, PullSummary, PullTab, Resolution, Settings } from './types.js';
const FRESH_FOR = 60_000;
type Stored = Omit<PullSummary, 'guide'> & { baseSHA: string; headSHA: string };
// Bot apps excluded by the search query when bot PRs are hidden; any other bot is filtered from results.
const BOT_APPS = ['dependabot', 'renovate', 'github-actions', 'mergify', 'snyk-bot'];
const NODE = '... on PullRequest { number title url isDraft state createdAt updatedAt additions deletions headRefName headRefOid baseRefOid author { __typename login } repository { nameWithOwner } reviewRequests(first: 25) { nodes { requestedReviewer { __typename ... on User { login } } } } }';
// GraphQL names app authors without the [bot] suffix that REST uses.
const authorLogin = (author: Record<string, any> | null | undefined) => { const login = String(author?.login ?? 'ghost'); return author?.__typename === 'Bot' && !login.endsWith('[bot]') ? `${login}[bot]` : login; };
const CURSOR = /^(offset:\d{1,5}|[A-Za-z0-9+/=_-]{1,300})$/;
const REPO_CURSOR = /^repo:(\d{1,2}):([A-Za-z0-9+/=_-]{0,300})$/;
export function pullQuery(input: unknown): PullQuery {
  const raw = fields(input), text = (key: string) => {
    const value = raw[key];
    if (value === undefined || typeof value === 'string') return value;
    throw new UserError('Invalid pull request filters.', 400);
  };
  return { tab: text('tab'), repo: text('repo'), author: text('author'), drafts: text('drafts'), sort: text('sort'), after: text('after'), refresh: raw.refresh === true };
}
// Lists open PRs for the configured repositories through the existing gh sign-in. Read-only.
export class Inbox {
  private viewer: Promise<string> | null = null;
  private pages = new Map<string, { at: number; value: PullPage }>();
  constructor(private store: Store, private runner: Runner = runCommand) {}
  private async json(args: string[]): Promise<unknown> {
    try { return JSON.parse(await this.runner('gh', args, { signal: new AbortController().signal, maxBytes: 10_000_000 })); }
    catch (error) { if (error instanceof SyntaxError) throw new UserError('GitHub returned an unreadable response.'); throw error; }
  }
  login(): Promise<string> {
    this.viewer ??= this.runner('gh', ['api', 'user', '--jq', '.login'], { signal: new AbortController().signal }).then(value => value.trim()).catch(error => { this.viewer = null; throw error; });
    return this.viewer;
  }
  private summarize(repo: string, raw: Record<string, any>, viewer: string, requested: boolean): Stored {
    const state = String(raw.state ?? 'OPEN').toLowerCase();
    return { repo, number: Number(raw.number), title: String(raw.title ?? '').slice(0, 500), author: String(raw.author?.login ?? 'ghost'), authorIsBot: Boolean(raw.author?.is_bot), isDraft: Boolean(raw.isDraft), state: state === 'merged' || state === 'closed' ? state : 'open', createdAt: String(raw.createdAt ?? ''), updatedAt: String(raw.updatedAt ?? ''), additions: Number(raw.additions) || 0, deletions: Number(raw.deletions) || 0, branch: String(raw.headRefName ?? ''), url: String(raw.url ?? `https://github.com/${repo}/pull/${raw.number}`), reviewRequested: requested, mine: raw.author?.login === viewer, baseSHA: String(raw.baseRefOid ?? ''), headSHA: String(raw.headRefOid ?? '') };
  }
  private guide(pull: Stored): GuideStatus | null { return /^[a-f0-9]{40}$/.test(pull.headSHA) ? this.store.guideStatus(pull.repo, pull.number, pull.headSHA) : null; }
  private publish({ baseSHA, headSHA, ...pull }: Stored): PullSummary { return { ...pull, guide: this.guide({ ...pull, baseSHA, headSHA }) }; }
  private scope(settings: Settings, repos: string[]): string {
    return `is:pr is:open archived:false ${repos.map(name => `repo:${name}`).join(' ')}${settings.showBots ? '' : ` ${BOT_APPS.map(app => `-author:app/${app}`).join(' ')}`}`;
  }
  // Search-palette entries: the latest page of open PRs, or title matches for typed words.
  async index(settings: Settings, text = ''): Promise<IndexedPull[]> {
    const words = text.slice(0, 200).replace(/[":]/g, ' ').split(/\s+/).map(word => word.replace(/^-+/, '')).filter(Boolean);
    if (!settings.repos.length || (text.trim() && !words.length)) return [];
    const query = `${this.scope(settings, settings.repos)}${settings.showDrafts ? '' : ' draft:false'}${words.length ? ` ${words.join(' ')} in:title` : ''} sort:updated-desc`;
    // GitHub search sometimes times out and answers with no results (REST flags these as incomplete), so an empty answer is retried.
    let nodes: Record<string, any>[] = [];
    for (let attempt = 0; attempt < 3 && !nodes.length; attempt++) {
      const data = await this.graphql(`query { page: search(query: ${JSON.stringify(query)}, type: ISSUE, first: ${words.length ? 20 : settings.pageSize}) { nodes { ... on PullRequest { number title author { __typename login } repository { nameWithOwner } } } } }`);
      nodes = Array.isArray(data.page?.nodes) ? data.page.nodes.filter((node: Record<string, any>) => node?.number) : [];
    }
    return nodes.filter(node => settings.showBots || node.author?.__typename !== 'Bot')
      .map(node => ({ repo: String(node.repository?.nameWithOwner ?? ''), number: Number(node.number), title: String(node.title ?? '').slice(0, 500), author: authorLogin(node.author) }));
  }
  // With `partial`, results are kept when some aliases fail (e.g. a PR number missing from one repository).
  private async graphql(query: string, partial = false): Promise<Record<string, any>> {
    let failed: string | undefined, output: string;
    const failure = (text: string) => { failed = text; try { const message = JSON.parse(text)?.errors?.[0]?.message; return message ? `GitHub search failed: ${message}` : undefined; } catch { return undefined; } };
    try { output = await this.runner('gh', ['api', 'graphql', '--input', '-'], { signal: new AbortController().signal, maxBytes: 10_000_000, input: JSON.stringify({ query }), failureDetail: failure }); }
    catch (error) { if (!partial || !failed) throw error; output = failed; }
    const value = JSON.parse(output);
    if (value?.errors?.length && !partial) throw new UserError(`GitHub search failed: ${value.errors[0].message}`);
    return value?.data ?? {};
  }
  private fromNode(raw: Record<string, any>, viewer: string, requested?: boolean): Stored {
    const reviewers: unknown[] = Array.isArray(raw.reviewRequests?.nodes) ? raw.reviewRequests.nodes : [];
    const pull = this.summarize(String(raw.repository?.nameWithOwner ?? ''), { ...raw, author: { login: authorLogin(raw.author) } }, viewer, requested ?? reviewers.some(node => (node as Record<string, any>)?.requestedReviewer?.login === viewer));
    return { ...pull, authorIsBot: raw.author?.__typename === 'Bot' };
  }
  // PRs with a stored guide for their current head commit. These come from the local database,
  // so this list is assembled here rather than by GitHub search.
  private async guided(repos: string[], viewer: string, filter: (pull: PullSummary) => boolean, sort: 'createdAt' | 'updatedAt'): Promise<PullSummary[]> {
    const rows = [...new Map(this.store.guidedPulls(repos).map(row => [`${row.repo}#${row.number}`, row])).values()];
    if (!rows.length) return [];
    let data: Record<string, any>;
    try { data = await this.graphql(`query { ${rows.map((row, i) => { const [owner, name] = row.repo.split('/'); return `g${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${row.number}) { ${NODE} } }`; }).join('\n')} }`, true); }
    catch { return []; }
    return rows.map((_, i) => data[`g${i}`]?.pullRequest).filter(Boolean).map(node => this.publish(this.fromNode(node, viewer)))
      .filter(pull => pull.state === 'open' && pull.guide !== null && filter(pull)).sort((a, b) => b[sort].localeCompare(a[sort]));
  }
  private async repositoryPage({ repos, pageSize, after, search, viewer, keep, requested }: { repos: string[]; pageSize: number; after?: string; search: (repo: string) => string; viewer: string; keep: (pull: PullSummary) => boolean; requested?: boolean }): Promise<Pick<PullPage, 'items' | 'cursor'>> {
    const parsed = after?.match(REPO_CURSOR);
    let index = parsed ? Number(parsed[1]) : 0, cursor = parsed?.[2] || undefined;
    if ((after && !parsed) || index >= repos.length) throw new UserError('Invalid page cursor.', 400);
    const items: PullSummary[] = [];
    while (index < repos.length && items.length < pageSize) {
      const data = await this.graphql(`query { page: search(query: ${JSON.stringify(`${search(repos[index])} sort:updated-desc`)}, type: ISSUE, first: ${pageSize - items.length}${cursor ? `, after: ${JSON.stringify(cursor)}` : ''}) { pageInfo { endCursor hasNextPage } nodes { ${NODE} } } }`);
      const page = data.page ?? {}, previous = cursor;
      items.push(...(Array.isArray(page.nodes) ? page.nodes : []).filter((node: Record<string, any>) => node?.number).map((node: Record<string, any>) => this.publish(this.fromNode(node, viewer, requested))).filter(keep));
      if (page.pageInfo?.hasNextPage) {
        cursor = page.pageInfo.endCursor;
        if (typeof cursor !== 'string' || !cursor || cursor === previous) throw new UserError('GitHub returned an invalid page cursor.');
      } else { index++; cursor = undefined; }
    }
    return { items, cursor: index < repos.length ? `repo:${index}:${cursor ?? ''}` : null };
  }
  // One page of open PRs across the configured repositories, fetched from GitHub search with a cursor.
  async page(settings: Settings, query: PullQuery): Promise<PullPage> {
    if (!settings.repos.length) return { items: [], total: 0, cursor: null, counts: { all: 0, review: 0, mine: 0, guides: 0 }, repos: [], errors: [] };
    const tab = (query.tab || 'all') as PullTab, repo = query.repo ?? '', author = query.author ?? '', after = query.after;
    if (!['all', 'review', 'mine', 'guides'].includes(tab)) throw new UserError('Unknown tab.', 400);
    if (repo && !settings.repos.includes(repo)) throw new UserError('That repository isn’t on your list.', 400);
    if (author && !/^[A-Za-z0-9-]{1,39}(\[bot\])?$/.test(author)) throw new UserError('Unknown author.', 400);
    const drafts = query.drafts ? query.drafts === 'shown' : settings.showDrafts, sort = query.sort === 'created' ? 'created' : query.sort === 'repo' ? 'repo' : 'updated';
    if (after && !(sort === 'repo' && tab !== 'guides' ? REPO_CURSOR : CURSOR).test(after)) throw new UserError('Invalid page cursor.', 400);
    const key = JSON.stringify([settings, tab, repo, author, drafts, sort, after]), cached = this.pages.get(key);
    if (cached && !query.refresh && Date.now() - cached.at < FRESH_FOR / 2) return cached.value;
    const viewer = await this.login(), first = !after, repos = (repo ? [repo] : [...settings.repos]).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const scope = (list: string[]) => this.scope(settings, list);
    const queriesFor = (list: string[]) => {
      const base = `${scope(list)}${author ? ` author:${author.endsWith('[bot]') ? `app/${author.slice(0, -5)}` : author}` : ''}${drafts ? '' : ' draft:false'}`;
      return { all: base, review: `${base} review-requested:@me`, mine: `${base} author:@me` };
    };
    const queries = queriesFor(repos);
    const count = (alias: string, query: string) => `${alias}: search(query: ${JSON.stringify(query)}, type: ISSUE, first: 0) { issueCount }`;
    const parts: string[] = [];
    if (tab !== 'guides' && sort !== 'repo') parts.push(`page: search(query: ${JSON.stringify(`${queries[tab]} sort:${sort}-desc`)}, type: ISSUE, first: ${settings.pageSize}${after ? `, after: ${JSON.stringify(after)}` : ''}) { issueCount pageInfo { endCursor hasNextPage } nodes { ${NODE} } }`);
    if (tab !== 'guides' && sort === 'repo' && !first) parts.push(count('total', queries[tab]));
    if (first) {
      parts.push(count('all', queries.all), count('review', queries.review), count('mine', queries.mine));
      settings.repos.forEach((name, i) => parts.push(count(`r${i}`, scope([name])), count(`q${i}`, `${scope([name])} review-requested:@me`)));
    }
    const keep = (pull: PullSummary) => (!author || pull.author === author) && (drafts || !pull.isDraft) && (settings.showBots || !pull.authorIsBot);
    const [data, guided, repositoryPage] = await Promise.all([
      parts.length ? this.graphql(`query { ${parts.join('\n')} }`) : Promise.resolve({} as Record<string, any>),
      tab === 'guides' || first ? this.guided(repos, viewer, keep, sort === 'created' ? 'createdAt' : 'updatedAt') : Promise.resolve([]),
      tab !== 'guides' && sort === 'repo' ? this.repositoryPage({ repos, pageSize: settings.pageSize, after, search: repo => queriesFor([repo])[tab], viewer, keep, requested: tab === 'review' ? true : undefined }) : Promise.resolve(null)
    ]);
    let items: PullSummary[], total: number, cursor: string | null;
    if (tab === 'guides') {
      if (sort === 'repo') guided.sort((a, b) => a.repo.localeCompare(b.repo, undefined, { sensitivity: 'base' }) || b.updatedAt.localeCompare(a.updatedAt));
      const offset = after ? Number(after.slice('offset:'.length)) || 0 : 0;
      items = guided.slice(offset, offset + settings.pageSize); total = guided.length; cursor = offset + settings.pageSize < guided.length ? `offset:${offset + settings.pageSize}` : null;
    } else if (repositoryPage) {
      ({ items, cursor } = repositoryPage); total = Number((first ? data[tab] : data.total)?.issueCount) || 0;
    } else {
      const page = data.page ?? {};
      items = (Array.isArray(page.nodes) ? page.nodes : []).filter((node: Record<string, any>) => node?.number).map((node: Record<string, any>) => this.publish(this.fromNode(node, viewer, tab === 'review' ? true : undefined))).filter(keep);
      total = Number(page.issueCount) || 0; cursor = page.pageInfo?.hasNextPage ? String(page.pageInfo.endCursor) : null;
    }
    const value: PullPage = {
      items, total, cursor, errors: [],
      counts: first ? { all: Number(data.all?.issueCount) || 0, review: Number(data.review?.issueCount) || 0, mine: Number(data.mine?.issueCount) || 0, guides: guided.length } : null,
      repos: first ? settings.repos.map((name, i) => ({ repo: name, open: Number(data[`r${i}`]?.issueCount) || 0, review: Number(data[`q${i}`]?.issueCount) || 0 })) : null
    };
    if (first) this.pages.set(key, { at: Date.now(), value });
    return value;
  }
  // Looks up a PR by link or number with one GraphQL call; also finds closed and merged PRs.
  async resolve(settings: Settings, query: string): Promise<Resolution> {
    const ref = query.length <= 500 ? parseReference(query) : null;
    if (!ref) return { kind: 'none', items: [] };
    const repos = ref.owner ? [parseRepo(`${ref.owner}/${ref.repo}`)] : settings.repos;
    if (!repos.length) return { kind: 'number', items: [] };
    const viewer = await this.login();
    let data: Record<string, any> = {};
    try { data = await this.graphql(`query { ${repos.map((repo, i) => { const [owner, name] = repo.split('/'); return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${ref.number}) { ${NODE} } }`; }).join('\n')} }`, true); }
    catch { if (ref.owner) return { kind: 'link', items: [], error: `GitHub could not find ${repos[0]}#${ref.number}, or this account can’t read it.` }; }
    const items = repos.map((_, i) => data[`r${i}`]?.pullRequest).filter(Boolean).map(node => this.publish(this.fromNode(node, viewer)));
    if (ref.owner && !items.length) return { kind: 'link', items: [], error: `GitHub could not find ${repos[0]}#${ref.number}, or this account can’t read it.` };
    return { kind: ref.owner ? 'link' : 'number', items };
  }
  async validateRepo(input: unknown): Promise<string> {
    const repo = parseRepo(input);
    let raw: unknown;
    try { raw = await this.json(['repo', 'view', repo, '--json', 'nameWithOwner']); }
    catch { throw new UserError(`GitHub could not find ${repo}, or this account can’t read it.`); }
    const name = (raw as Record<string, unknown> | null)?.nameWithOwner;
    return typeof name === 'string' ? parseRepo(name) : repo;
  }
}
