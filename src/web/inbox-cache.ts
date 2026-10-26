import { comparePulls, listFilters, matchesList } from '../pull-list.js';
import type { PullFilters, PullPage, PullQuery, PullSummary, Settings } from '../types.js';

type Entry = {
  ids: Set<string>;
  cursor: string | null;
  total: number;
  loaded: boolean;
  at: number;
  request: number;
  pending: Promise<PullPage | undefined> | null;
  loadingMore: boolean;
  error: string;
  failedMore: boolean;
};
type Metadata = Pick<PullPage, 'counts' | 'repos'> & { request: number };
const keyOf = (pull: PullSummary) => `${pull.repo.toLowerCase()}#${pull.number}`;
const scopeOf = (settings: Settings) => JSON.stringify([settings.repos, settings.pageSize, settings.showBots, settings.showDrafts]);

export class InboxCache {
  private scope = '';
  private rows = new Map<string, { pull: PullSummary; request: number }>();
  private lists = new Map<string, Entry>();
  private metadata = new Map<string, Metadata>();
  private listeners = new Set<() => void>();
  private version = 0;
  private sequence = 0;

  constructor(private fetchPage: (query: PullQuery) => Promise<PullPage>) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;
  private publish() { this.version++; this.listeners.forEach(listener => listener()); }
  private keys(settings: Settings, filters: PullFilters) {
    const normalized = listFilters(filters, settings);
    const { tab, sort, ...rest } = normalized;
    return { normalized, list: JSON.stringify(normalized), metadata: JSON.stringify(rest) };
  }

  read(settings: Settings, filters: PullFilters) {
    const { normalized, list, metadata } = this.keys(settings, filters);
    const sameScope = this.scope === scopeOf(settings);
    const entry = sameScope ? this.lists.get(list) : undefined;
    const info = sameScope ? this.metadata.get(metadata) : undefined;
    const rows = sameScope ? [...this.rows.values()] : [];
    const complete = Boolean(entry?.loaded && entry.cursor === null);
    const items = rows.filter(({ pull, request }) => matchesList(pull, normalized, settings) && (!complete || entry?.ids.has(keyOf(pull)) || request > (entry?.request ?? Infinity))).map(row => row.pull).sort((a, b) => comparePulls(normalized.sort, a, b));
    return {
      items, counts: info?.counts ?? null, repos: info?.repos ?? null,
      total: entry?.loaded ? entry.total : info?.counts?.[normalized.tab] ?? null,
      cursor: entry?.cursor ?? null, loaded: entry?.loaded ?? false, complete,
      loading: Boolean(entry?.pending), loadingMore: entry?.loadingMore ?? false, error: entry?.error ?? '', failedMore: entry?.failedMore ?? false,
    };
  }

  load(settings: Settings, filters: PullFilters, { more = false, force = false } = {}): Promise<PullPage | undefined> {
    const scope = scopeOf(settings);
    if (scope !== this.scope) { this.scope = scope; this.rows.clear(); this.lists.clear(); this.metadata.clear(); }
    const keys = this.keys(settings, filters);
    let entry = this.lists.get(keys.list);
    if (!entry) {
      entry = { ids: new Set(), cursor: null, total: 0, loaded: false, at: 0, request: 0, pending: null, loadingMore: false, error: '', failedMore: false };
      this.lists.set(keys.list, entry);
    }
    if (entry.pending) return entry.pending;
    if (more ? !entry.loaded || !entry.cursor : !force && entry.loaded && Date.now() - entry.at < 30_000) return Promise.resolve(undefined);
    const target = entry, request = ++this.sequence;
    const query = { ...filters, sort: keys.normalized.sort, ...(more ? { after: target.cursor ?? undefined } : {}) };
    target.error = ''; target.loadingMore = more; target.failedMore = more;
    target.pending = this.fetchPage(query).then(page => {
      if (this.scope !== scope || this.lists.get(keys.list) !== target) return undefined;
      for (const pull of page.items) {
        const key = keyOf(pull), previous = this.rows.get(key);
        if (!previous || previous.request <= request) this.rows.set(key, { pull, request });
      }
      target.ids = new Set([...(more ? target.ids : []), ...page.items.map(keyOf)]);
      target.cursor = page.cursor; target.total = page.total; target.loaded = true; target.at = Date.now(); target.request = request;
      if (page.counts && page.repos && (this.metadata.get(keys.metadata)?.request ?? 0) <= request) this.metadata.set(keys.metadata, { counts: page.counts, repos: page.repos, request });
      return page;
    }).catch(error => {
      if (this.scope === scope && this.lists.get(keys.list) === target) target.error = error instanceof Error ? error.message : 'Could not load pull requests.';
      return undefined;
    }).finally(() => {
      target.pending = null; target.loadingMore = false;
      if (this.scope === scope && this.lists.get(keys.list) === target) this.publish();
    });
    this.publish();
    return target.pending;
  }
}
