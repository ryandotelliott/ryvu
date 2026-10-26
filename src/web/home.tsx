import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { BookOpen, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { listPulls } from '../inbox.functions';
import { ago, agoLong, readProgress, remember, seedIndex, useNow } from './browser-state';
import { groupPulls } from './home-groups';
import { homeLink, pullLink } from './links';
import { AddRepoForm } from './settings';
import { Avatar, focusOnKeyboardOpen, RadioRows, PullIcon, Tip } from './ui';
import type { PullFilters, PullPage, PullSummary, PullTab, PullSort, Settings } from '../types';

const tabLabels: [PullTab, string][] = [['all', 'All open'], ['review', 'Review requested'], ['mine', 'Authored by me'], ['guides', 'Guide ready']];

type ListState = { items: PullSummary[]; cursor: string | null; total: number; counts: NonNullable<PullPage['counts']>; repos: NonNullable<PullPage['repos']> };
export function Home({ filters, settings, onPage, onSettings }: { filters: PullFilters; settings: Settings | null; onPage: (page: PullPage) => void; onSettings: (settings: Settings) => void }) {
  const [data, setData] = useState<ListState | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false), [moreError, setMoreError] = useState('');
  const request = useRef(0), sentinel = useRef<HTMLDivElement>(null), now = useNow(), navigate = useNavigate();
  const current = { tab: filters.tab ?? '', repo: filters.repo ?? '', author: filters.author ?? '', drafts: filters.drafts ?? '', sort: filters.sort ?? '' };
  const query = new URLSearchParams(Object.entries(current).filter(([, value]) => value)).toString(), configured = settings ? settings.repos.length > 0 : null;
  // The first page carries tab counts and per-repository totals; later pages only add items.
  async function load() {
    const id = ++request.current; setLoading(true); setMoreError('');
    try {
      const page = await listPulls({ data: filters });
      if (id !== request.current) return;
      remember(page.items); setError(''); onPage(page);
      if (!query) seedIndex(page.items);
      setData({ items: page.items, cursor: page.cursor, total: page.total, counts: page.counts ?? { all: 0, review: 0, mine: 0, guides: 0 }, repos: page.repos ?? [] });
    } catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : 'Could not load pull requests.'); }
    finally { if (id === request.current) setLoading(false); }
  }
  async function loadMore() {
    if (!data?.cursor || loadingMore || loading) return;
    const id = request.current, cursor = data.cursor; setLoadingMore(true); setMoreError('');
    try {
      const page = await listPulls({ data: { ...filters, after: cursor } });
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
  const set = (key: keyof PullFilters, value: string) => void navigate(homeLink({ ...current, [key]: value }));
  if (configured === false) return <Onboarding onSettings={onSettings} />;
  const drafts = current.drafts || (settings?.showDrafts === false ? 'hidden' : 'shown');
  const openTotal = data?.repos.reduce((sum, repo) => sum + repo.open, 0) ?? 0;
  const tab = tabLabels.find(([name]) => name === current.tab)?.[0] ?? 'all';
  const sort: PullSort = current.sort === 'created' ? 'created' : current.sort === 'repo' ? 'repo' : 'updated';
  const groups = groupPulls(data?.items ?? [], sort, now);
  // Without a full list, author choices come from the PRs loaded so far.
  const authors = [...new Set([...(data?.items.map(pull => pull.author) ?? []), ...(current.author ? [current.author] : [])])].sort((a, b) => a.localeCompare(b));
  return <div className="home">
    <header className="page-heading">
      <h1>{current.repo || 'Pull requests'}</h1>
      <span className="page-sub">{data ? (current.repo ? `${data.repos.find(repo => repo.repo === current.repo)?.open ?? 0} open` : `${openTotal} open across ${data.repos.length} ${data.repos.length === 1 ? 'repository' : 'repositories'}`) : <Skeleton className="h-4 w-52" />}</span>
    </header>
    <div className="filters">
      <nav className="tabs" aria-label="Pull request lists">
        {tabLabels.map(([name, label]) => <Link key={name} {...homeLink({ ...current, tab: name === 'all' ? undefined : name })} className={tab === name ? 'is-active' : ''} aria-current={tab === name ? 'page' : undefined}>
          {label}<span className="tab-count">{data ? data.counts[name] : <Skeleton className="h-3 w-5" />}</span>
        </Link>)}
      </nav>
      <Popover>
        <Tip content="List options" side="bottom"><PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="list-options" aria-label="List options" />}><SlidersHorizontal /></PopoverTrigger></Tip>
        <PopoverContent align="end" className="w-68 gap-0 p-1" initialFocus={focusOnKeyboardOpen}>
          <PopoverTitle className="px-2 py-1.5 text-xs text-muted-foreground">Filters</PopoverTitle>
          <FilterCombobox label="Repository" search="Find a repository…" value={current.repo} display={current.repo ? current.repo.split('/')[1] : 'All'} onChange={value => set('repo', value)} options={[{ value: '', label: 'All repositories' }, ...(settings?.repos ?? []).map(repo => ({ value: repo, label: repo }))]} />
          <FilterCombobox label="Author" search="Find an author…" value={current.author} display={current.author || 'Anyone'} onChange={value => set('author', value)} options={[{ value: '', label: 'Anyone' }, ...authors.map(author => ({ value: author, label: author, icon: <Avatar login={author} size={16} /> }))]} />
          <FilterMenu label="Drafts" value={drafts} display={drafts === 'hidden' ? 'Hidden' : 'Shown'} onChange={value => set('drafts', value)} options={[{ value: 'shown', label: 'Show drafts' }, { value: 'hidden', label: 'Hide drafts' }]} />
          <Separator className="my-1" />
          <FilterMenu label="Sort by" value={sort} display={sort === 'created' ? 'Recently created' : sort === 'repo' ? 'Repository' : 'Recently updated'} onChange={value => set('sort', value === 'updated' ? '' : value)} options={[{ value: 'updated', label: 'Recently updated' }, { value: 'created', label: 'Recently created' }, { value: 'repo', label: 'Repository' }]} />
        </PopoverContent>
      </Popover>
    </div>
    {error && !data?.items.length ? <div className="empty"><p>{error}</p><Button variant="ghost" size="xs" onClick={() => void load()}>Try again</Button></div>
      : !data || (loading && !data.items.length) ? <div className="pull-groups" aria-busy="true" aria-label="Loading pull requests"><section className="pull-group">
        <h2 className="pull-group-heading h-[18px]"><Skeleton className="h-3 w-28" /></h2>
        <ul className="pull-list">{Array.from({ length: 6 }, (_, i) => <li key={i}><PullRowSkeleton /></li>)}</ul>
      </section></div>
      : data.items.length === 0 ? <div className="empty"><p>{data.total === 0 && tab === 'all' && !current.repo && !current.author ? 'No open pull requests in these repositories.' : 'No pull requests match these filters.'}</p>{(current.repo || current.author || current.tab || current.drafts) && <Link {...homeLink()} className={buttonVariants({ variant: 'ghost', size: 'xs' })}>Clear filters</Link>}</div>
      : <div className={`pull-groups ${loading ? 'is-loading' : ''}`}>
        {groups.map(group => <section className="pull-group" key={group.key} aria-label={group.title}>
          <h2 className="pull-group-heading">{group.title}</h2>
          <ul className="pull-list">{group.items.map(pull => <PullRow key={`${pull.repo}#${pull.number}`} pull={pull} now={now} sort={sort} />)}</ul>
        </section>)}
        {data.cursor && !moreError && <div ref={sentinel} aria-busy="true" aria-label="Loading more pull requests"><PullRowSkeleton /></div>}
      </div>}
    {moreError && <div className="list-end"><span>{moreError}</span><Button variant="ghost" size="xs" onClick={() => void loadMore()}>Try again</Button></div>}
    {data && !data.cursor && data.items.length > 0 && <div className="list-end">{data.items.length === 1 ? 'That’s the only one' : `That’s all ${data.items.length}`}</div>}
  </div>;
}

function PullRowSkeleton() {
  return <div className="pull-row skeleton" aria-hidden="true">
    <span className="pull-status"><Skeleton className="h-4 w-3.5" /></span>
    <div className="pull-text"><div className="pull-title flex h-[1.5em] items-center"><Skeleton className="h-3.5 w-3/4" /></div><div className="pull-meta h-[1.5em]"><Skeleton className="h-3 w-3/5" /></div></div>
    <span className="pull-chips" />
    <div className="diffstat min-h-[1.5em] items-center"><Skeleton className="h-3 w-8" /><Skeleton className="h-3 w-8" /></div>
    <Skeleton className="avatar size-5 rounded-full" />
    <div className="pull-updated flex h-[1.5em] items-center justify-end"><Skeleton className="h-3 w-7" /></div>
  </div>;
}

function GuideChip({ pull }: { pull: PullSummary }) {
  if (!pull.guide) return null;
  const read = Math.min(readProgress(pull.guide.key).length, pull.guide.chapters);
  const label = read === 0 ? 'Guide ready' : read === pull.guide.chapters ? 'Guide reviewed' : `Guide · ${read} of ${pull.guide.chapters} read`;
  return <span className="chip guide"><BookOpen size={11} />{label}</span>;
}
function PullRow({ pull, now, sort }: { pull: PullSummary; now: number; sort: PullSort }) {
  const timestamp = sort === 'created' ? pull.createdAt : pull.updatedAt, dateLabel = sort === 'created' ? 'Created' : 'Updated';
  return <li><Link {...pullLink(pull.repo, pull.number)} className={`pull-row ${pull.isDraft ? 'is-draft' : ''}`}>
    <span className="pull-status"><PullIcon draft={pull.isDraft} state={pull.state} /></span>
    <span className="pull-text">
      <span className="pull-title">{pull.title}</span>
      <span className="pull-meta">{pull.repo} #{pull.number} · opened {agoLong(pull.createdAt, now)} by {pull.author}</span>
    </span>
    <span className="pull-chips">{pull.reviewRequested && <span className="chip review">Review requested</span>}<GuideChip pull={pull} />{pull.isDraft && <span className="chip">Draft</span>}</span>
    <span className="diffstat"><span className="added">+{pull.additions.toLocaleString()}</span><span className="removed">−{pull.deletions.toLocaleString()}</span></span>
    <Avatar login={pull.author} />
    <Tip content={`${dateLabel} ${new Date(timestamp).toLocaleString()}`} delay="long"><time className="pull-updated" dateTime={timestamp}>{ago(timestamp, now)}</time></Tip>
  </Link></li>;
}

type FilterOption = { value: string; label: string; icon?: ReactNode };
function FilterTrigger({ label, display }: { label: ReactNode; display: string }) {
  return <><span>{label}</span><span className="ml-auto max-w-36 truncate text-muted-foreground">{display}</span></>;
}
function FilterMenu({ label, value, display, options, onChange }: { label: string; value: string; display: string; options: FilterOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false), isMobile = useIsMobile();
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="ghost" className="w-full justify-start px-2 font-normal" />}><FilterTrigger label={label} display={display} /><ChevronRight /></PopoverTrigger>
    <PopoverContent side={isMobile ? 'bottom' : 'right'} align={isMobile ? 'end' : 'start'} sideOffset={8} className="w-56 max-w-[calc(100vw-16px)] gap-1 p-1" initialFocus={focusOnKeyboardOpen}>
      <PopoverTitle className="sr-only">{label}</PopoverTitle>
      <RadioRows label={label} value={value} onChange={next => { setOpen(false); onChange(next); }} options={options} />
    </PopoverContent>
  </Popover>;
}

// A filter menu with a search field, for lists that can get long.
function FilterCombobox({ label, search, value, display, options, onChange }: { label: ReactNode; search: string; value: string; display: string; options: FilterOption[]; onChange: (value: string) => void }) {
  const isMobile = useIsMobile();
  return <Combobox items={options} value={options.find(option => option.value === value) ?? null} onValueChange={next => { if (next) onChange(next.value); }}
      itemToStringLabel={option => option.label} isItemEqualToValue={(a, b) => a.value === b.value} autoHighlight>
    <ComboboxTrigger className="[&>svg:last-child]:-rotate-90" render={<Button variant="ghost" className="w-full justify-start px-2 font-normal" />}><FilterTrigger label={label} display={display} /></ComboboxTrigger>
    <ComboboxContent side={isMobile ? 'bottom' : 'right'} align={isMobile ? 'end' : 'start'} sideOffset={8} className="w-72 min-w-0">
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
