import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpDown, BookOpen, ChevronDown, RotateCw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api, ago, agoLong, readProgress, remember, seedIndex, useNow } from './api';
import { homeHref, navigate, prHref } from './routes';
import { AddRepoForm } from './settings';
import { Avatar, PullIcon, RepoSwatch, Tip, repoColor } from './ui';
import type { PullPage, PullSummary, PullTab, Settings } from '../types';

const tabLabels: [PullTab, string][] = [['all', 'All open'], ['review', 'Review requested'], ['mine', 'Authored by me'], ['guides', 'Guide ready']];
const filterKeys = ['tab', 'repo', 'author', 'drafts', 'sort'] as const;

type ListState = { items: PullSummary[]; cursor: string | null; total: number; counts: NonNullable<PullPage['counts']>; repos: NonNullable<PullPage['repos']> };
export function Home({ params, settings, onPage, onSettings }: { params: URLSearchParams; settings: Settings | null; onPage: (page: PullPage) => void; onSettings: (settings: Settings) => void }) {
  const [data, setData] = useState<ListState | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false), [moreError, setMoreError] = useState(''), [refreshing, setRefreshing] = useState(false);
  const request = useRef(0), sentinel = useRef<HTMLLIElement>(null), now = useNow();
  const current = Object.fromEntries(filterKeys.map(key => [key, params.get(key) ?? ''])) as Record<(typeof filterKeys)[number], string>;
  const query = new URLSearchParams(Object.entries(current).filter(([, value]) => value)).toString(), configured = settings ? settings.repos.length > 0 : null;
  // The first page carries tab counts and per-repository totals; later pages only add items.
  async function load(refresh = false) {
    const id = ++request.current; setLoading(true); setMoreError(''); if (refresh) setRefreshing(true);
    try {
      const page = await api<PullPage>(`/api/pulls?${query}${refresh ? `${query ? '&' : ''}refresh=1` : ''}`);
      if (id !== request.current) return;
      remember(page.items); setError(''); onPage(page);
      if (!query) seedIndex(page.items);
      setData({ items: page.items, cursor: page.cursor, total: page.total, counts: page.counts ?? { all: 0, review: 0, mine: 0, guides: 0 }, repos: page.repos ?? [] });
    } catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : 'Could not load pull requests.'); }
    finally { if (id === request.current) { setLoading(false); setRefreshing(false); } }
  }
  async function loadMore() {
    if (!data?.cursor || loadingMore || loading) return;
    const id = request.current, cursor = data.cursor; setLoadingMore(true); setMoreError('');
    try {
      const page = await api<PullPage>(`/api/pulls?${query}${query ? '&' : ''}after=${encodeURIComponent(cursor)}`);
      if (id !== request.current) return;
      remember(page.items);
      setData(previous => previous && previous.cursor === cursor ? { ...previous, items: [...previous.items, ...page.items.filter(pull => !previous.items.some(item => item.url === pull.url))], cursor: page.cursor } : previous);
    } catch (e) { if (id === request.current) setMoreError(e instanceof Error ? e.message : 'Could not load more pull requests.'); }
    finally { if (id === request.current) setLoadingMore(false); }
  }
  // Keep the counts in the heading and tabs while the new list loads, so the layout holds still.
  useEffect(() => { if (configured) { setData(previous => previous && { ...previous, items: [], cursor: null }); void load(); } }, [query, configured, settings?.repos.join('|'), settings?.pageSize, settings?.showBots, settings?.showDrafts]);
  useEffect(() => {
    // Fetch the next page shortly before the end of the list scrolls into view.
    const node = sentinel.current;
    if (!node || !data?.cursor || moreError) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadMore(); }, { rootMargin: '600px 0px' });
    observer.observe(node); return () => observer.disconnect();
  }, [data?.cursor, data?.items.length, loadingMore, moreError]);
  const set = (key: string, value: string | number) => navigate(homeHref({ ...current, [key]: value }));
  if (configured === false) return <Onboarding onSettings={onSettings} />;
  const drafts = current.drafts || (settings?.showDrafts === false ? 'hidden' : 'shown');
  const openTotal = data?.repos.reduce((sum, repo) => sum + repo.open, 0) ?? 0;
  const tab = (current.tab || 'all') as PullTab;
  // Without a full list, author choices come from the PRs loaded so far.
  const authors = [...new Set([...(data?.items.map(pull => pull.author) ?? []), ...(current.author ? [current.author] : [])])].sort((a, b) => a.localeCompare(b));
  return <div className="home">
    <header className="page-heading">
      <h1>{current.repo || 'Pull requests'}</h1>
      {data && <span className="page-sub">{current.repo ? `${data.repos.find(repo => repo.repo === current.repo)?.open ?? 0} open` : `${openTotal} open across ${data.repos.length} ${data.repos.length === 1 ? 'repository' : 'repositories'}`}</span>}
      <Tip content="Refresh"><Button variant="ghost" size="icon" className="heading-action" aria-label="Refresh pull requests" onClick={() => void load(true)} disabled={refreshing}><RotateCw size={15} className={refreshing ? 'spinner' : ''} /></Button></Tip>
    </header>
    <div className="filters">
      <nav className="tabs" aria-label="Pull request lists">
        {tabLabels.map(([name, label]) => <a key={name} href={homeHref({ ...current, tab: name === 'all' ? undefined : name })} className={tab === name ? 'is-active' : ''} aria-current={tab === name ? 'page' : undefined}>
          {label}{data && <span className="tab-count">{data.counts[name]}</span>}
        </a>)}
      </nav>
      <div className="filter-menus">
        <FilterCombobox label="Repository" search="Find a repository…" value={current.repo} display={current.repo ? current.repo.split('/')[1] : 'All'} onChange={value => set('repo', value)} options={[{ value: '', label: 'All repositories' }, ...(settings?.repos ?? []).map(repo => ({ value: repo, label: repo, icon: <RepoSwatch color={repoColor(settings!.repos, repo)} /> }))]} />
        <FilterCombobox label="Author" search="Find an author…" value={current.author} display={current.author || 'Anyone'} onChange={value => set('author', value)} options={[{ value: '', label: 'Anyone' }, ...authors.map(author => ({ value: author, label: author, icon: <Avatar login={author} size={16} /> }))]} />
        <FilterMenu label="Drafts" value={drafts} display={drafts === 'hidden' ? 'Hidden' : 'Shown'} onChange={value => set('drafts', value)} options={[{ value: 'shown', label: 'Show drafts' }, { value: 'hidden', label: 'Hide drafts' }]} />
        <FilterMenu label={<ArrowUpDown size={13} />} value={current.sort || 'updated'} display={current.sort === 'created' ? 'Newest' : 'Recently updated'} plain onChange={value => set('sort', value === 'updated' ? '' : value)} options={[{ value: 'updated', label: 'Recently updated' }, { value: 'created', label: 'Newest' }]} />
      </div>
    </div>
    {error && !data?.items.length ? <div className="empty"><p>{error}</p><Button variant="ghost" size="xs" onClick={() => void load()}>Try again</Button></div>
      : !data || (loading && !data.items.length) ? <ul className="pull-list" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <li key={i} className="pull-row skeleton"><span className="bone" style={{ width: `${48 - i * 4}%` }} /><span className="bone short" /></li>)}</ul>
      : data.items.length === 0 ? <div className="empty"><p>{data.total === 0 && tab === 'all' && !current.repo && !current.author ? 'No open pull requests in these repositories.' : 'No pull requests match these filters.'}</p>{(current.repo || current.author || current.tab || current.drafts) && <a className={buttonVariants({ variant: 'ghost', size: 'xs' })} href="/">Clear filters</a>}</div>
      : <ul className={`pull-list ${loading ? 'is-loading' : ''}`}>
        {data.items.map(pull => <PullRow key={`${pull.repo}#${pull.number}`} pull={pull} color={repoColor(settings?.repos ?? [], pull.repo)} now={now} />)}
        {data.cursor && !moreError && <li ref={sentinel} className="pull-row skeleton" aria-busy="true"><span className="bone" style={{ width: '42%' }} /><span className="bone short" /></li>}
      </ul>}
    {moreError && <div className="list-end"><span>{moreError}</span><Button variant="ghost" size="xs" onClick={() => void loadMore()}>Try again</Button></div>}
    {data && !data.cursor && data.items.length > 0 && <div className="list-end">{data.items.length === 1 ? 'That’s the only one' : `That’s all ${data.items.length}`}</div>}
  </div>;
}

function GuideChip({ pull }: { pull: PullSummary }) {
  if (!pull.guide) return null;
  const read = Math.min(readProgress(pull.guide.key).length, pull.guide.chapters);
  const label = read === 0 ? 'Guide ready' : read === pull.guide.chapters ? 'Guide reviewed' : `Guide · ${read} of ${pull.guide.chapters} read`;
  return <span className="chip guide"><BookOpen size={11} />{label}</span>;
}
function PullRow({ pull, color, now }: { pull: PullSummary; color: string; now: number }) {
  return <li><a className={`pull-row ${pull.isDraft ? 'is-draft' : ''}`} href={prHref(pull.repo, pull.number)}>
    <span className="pull-status"><PullIcon draft={pull.isDraft} state={pull.state} /></span>
    <span className="pull-text">
      <span className="pull-title">{pull.title}</span>
      <span className="pull-meta"><RepoSwatch color={color} size={7} />{pull.repo} #{pull.number} · opened {agoLong(pull.createdAt, now)} by {pull.author}</span>
    </span>
    <span className="pull-chips">{pull.reviewRequested && <span className="chip review">Review requested</span>}<GuideChip pull={pull} />{pull.isDraft && <span className="chip">Draft</span>}</span>
    <span className="diffstat"><span className="added">+{pull.additions.toLocaleString()}</span><span className="removed">−{pull.deletions.toLocaleString()}</span></span>
    <Avatar login={pull.author} />
    <Tip content={`Updated ${new Date(pull.updatedAt).toLocaleString()}`} delay="long"><span className="pull-updated">{ago(pull.updatedAt, now)}</span></Tip>
  </a></li>;
}

type FilterOption = { value: string; label: string; icon?: ReactNode };
function FilterTrigger({ label, display }: { label: ReactNode; display: string }) {
  return <><span className="filter-label">{label}</span><span className="filter-value">{display}</span></>;
}
function FilterMenu({ label, value, display, options, onChange, plain }: { label: ReactNode; value: string; display: string; options: FilterOption[]; onChange: (value: string) => void; plain?: boolean }) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant={plain ? 'ghost' : 'outline'} size="sm" />}><FilterTrigger label={label} display={display} />{!plain && <ChevronDown className="text-muted-foreground" />}</DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={6} className="w-auto min-w-48">
      <DropdownMenuRadioGroup value={value} onValueChange={next => onChange(String(next))}>
        {options.map(option => <DropdownMenuRadioItem key={option.value || 'all'} value={option.value}>{option.icon}{option.label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

// A filter menu with a search field, for lists that can get long.
function FilterCombobox({ label, search, value, display, options, onChange }: { label: ReactNode; search: string; value: string; display: string; options: FilterOption[]; onChange: (value: string) => void }) {
  return <Combobox items={options} value={options.find(option => option.value === value) ?? null} onValueChange={next => { if (next) onChange(next.value); }}
      itemToStringLabel={option => option.label} isItemEqualToValue={(a, b) => a.value === b.value} autoHighlight>
    <ComboboxTrigger render={<Button variant="outline" size="sm" />}><FilterTrigger label={label} display={display} /></ComboboxTrigger>
    <ComboboxContent align="end" className="w-auto min-w-60">
      <ComboboxInput showTrigger={false} placeholder={search} />
      <ComboboxEmpty>No matches</ComboboxEmpty>
      <ComboboxList>
        {(option: FilterOption) => <ComboboxItem key={option.value || 'all'} value={option}>{option.icon}<span className="truncate">{option.label}</span></ComboboxItem>}
      </ComboboxList>
    </ComboboxContent>
  </Combobox>;
}

function Onboarding({ onSettings }: { onSettings: (settings: Settings) => void }) {
  return <div className="onboarding">
    <h1>Choose the repositories you review</h1>
    <p>Open pull requests from these repositories show up here, with a guided walkthrough one click away. You can change them any time in Settings.</p>
    <AddRepoForm onAdded={onSettings} autoFocus />
  </div>;
}
