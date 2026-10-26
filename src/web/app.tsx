import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ExternalLink, RotateCw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { openSession } from '../inbox.functions';
import { cancelAnalysis, getAnalysis, startAnalysis } from '../jobs.functions';
import { getPull } from '../pull.functions';
import { setSessionToken } from '../session';
import { AppContext, useApplication } from './application-context';
import { recall } from './browser-state';
import { hiddenPaths } from './file-filters';
import { homeLink, pullLink, type PullTarget, type PullViewName } from './links';
import { CommandPalette } from './palette';
import { AppShell } from './shell';
import { SidebarProvider } from '@/components/ui/sidebar';
import { PullIcon, RepoSwatch, StatusBox, Tip, repoColor } from './ui';
import type { JobView, PullDetail, PullPage as PullList, Settings } from '../types';

const loadPullView = () => import('./pull');
const PullView = lazy(() => loadPullView().then(module => ({ default: module.PullView })));

function useAppState() {
  const [connection, setConnection] = useState<'connecting' | 'ready' | 'offline'>('connecting');
  const [settings, setSettings] = useState<Settings | null>(null), [repoCounts, setRepoCounts] = useState<Record<string, number> | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The PR being read, loaded without analysis.
  const [pull, setPull] = useState<{ key: string; detail: PullDetail } | null>(null), [loadError, setLoadError] = useState(''), loading = useRef<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null), [jobError, setJobError] = useState(''), [jobKey, setJobKey] = useState<string | null>(null);
  const client = useRef(crypto.randomUUID()), sequence = useRef(0), epoch = useRef(0), currentJob = useRef<string | null>(null);
  const analyzing = job?.state === 'loading' || job?.state === 'generating';
  useEffect(() => {
    openSession().then(session => { setSessionToken(session.token); setConnection('ready'); setSettings(session.settings); }).catch(() => setConnection('offline'));
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(open => !open); } };
    window.addEventListener('keydown', onKey);
    // Fast Refresh reruns this effect on a hot update, so its cleanup must not end a running analysis.
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  async function load(next: PullTarget) {
    loading.current = next.key; setLoadError('');
    try {
      const detail = await getPull({ data: { repo: next.repo, number: next.number } });
      if (loading.current === next.key) setPull({ key: next.key, detail });
    } catch (e) { if (loading.current === next.key) setLoadError(e instanceof Error ? e.message : 'Could not load the pull request.'); }
  }
  // Files hidden by the reviewer's filters are left out of the analysis.
  async function analyze(next: PullTarget, fresh: boolean, paths: string[]) {
    const version = ++epoch.current; currentJob.current = null; setJobError(''); setJobKey(next.key);
    setJob({ id: '', state: 'loading', message: 'Reading the pull request…' });
    try {
      let value = await startAnalysis({ data: { clientId: client.current, sequence: ++sequence.current, url: next.url, fresh, ignored: hiddenPaths(next.repo, paths) } });
      if (version !== epoch.current) return;
      currentJob.current = value.id;
      while (version === epoch.current) {
        setJob(value);
        if (value.state === 'complete' && value.result) {
          const result = value.result; currentJob.current = null;
          setPull(current => current?.key === next.key ? { key: next.key, detail: { ...current.detail, snapshot: result.snapshot, guide: result, prior: null } } : current);
          break;
        }
        if (value.state === 'failed') { setJobError(value.error ?? value.message); currentJob.current = null; break; }
        if (value.state === 'cancelled') { currentJob.current = null; break; }
        await new Promise(resolve => setTimeout(resolve, 900));
        if (version !== epoch.current) break;
        value = await getAnalysis({ data: { id: value.id } });
      }
    } catch (e) { if (version === epoch.current) { setJobError(e instanceof Error ? e.message : 'Request failed.'); setJob(null); } }
  }
  async function cancel() {
    // Keep waiting for the job id if the initial POST is still in flight.
    const id = currentJob.current;
    if (!id) return;
    ++epoch.current;
    try { setJob(await cancelAnalysis({ data: { id, clientId: client.current } })); currentJob.current = null; }
    catch (e) { setJobError(e instanceof Error ? e.message : 'Cancellation failed.'); setJob(null); }
  }
  const onPage = (page: PullList) => { if (page.repos) setRepoCounts(Object.fromEntries(page.repos.map(repo => [repo.repo, repo.open]))); };
  return { connection, settings, setSettings, repoCounts, onPage, paletteOpen, setPaletteOpen, openPalette: () => setPaletteOpen(true), pull, setPull, loadError, loading, load, job, jobError, jobKey, analyzing, epoch, currentJob, analyze, cancel };
}

export type ApplicationState = ReturnType<typeof useAppState>;
export function Application({ children }: { children: ReactNode }) {
  const app = useAppState();
  return <SidebarProvider defaultOpen={typeof document === 'undefined' || !document.cookie.split('; ').includes('sidebar_state=false')}><AppContext.Provider value={app}>
    {children}
    <CommandPalette open={app.paletteOpen} onOpenChange={app.setPaletteOpen} settings={app.settings} />
  </AppContext.Provider></SidebarProvider>;
}

export function PullPage({ target }: { target: PullTarget }) {
  const app = useApplication(), navigate = useNavigate();
  useEffect(() => { void loadPullView(); }, []);
  useEffect(() => {
    if (app.connection !== 'ready') return;
    if (app.pull?.key !== target.key && app.loading.current !== target.key) void app.load(target);
  }, [target.key, app.connection]);
  const shown = app.pull?.key === target.key ? app.pull.detail : null;
  // ?analyze=1 (from search) starts analysis once the PR has loaded, then drops the flag.
  useEffect(() => {
    if (!target.analyze || !shown) return;
    void navigate({ ...pullLink(target.repo, target.number, 'guide'), replace: true });
    if (!shown.guide && !(app.analyzing && app.jobKey === target.key)) void app.analyze(target, false, shown.snapshot.files.map(file => file.path));
  }, [target.key, target.analyze, Boolean(shown)]);
  useEffect(() => { document.title = shown ? `${shown.snapshot.title} · PR Guide` : 'Loading · PR Guide'; }, [shown, target.key]);
  const color = repoColor(app.settings?.repos ?? [], target.repo), forThis = app.jobKey === target.key;
  const navigation = { settings: app.settings, repoCounts: app.repoCounts, onSearch: app.openPalette };
  const preparing = <AppShell settings={app.settings} repoCounts={app.repoCounts} onSearch={app.openPalette}><Preparing target={target} error={app.loadError} onRetry={() => { app.loading.current = null; void app.load(target); }} color={color} /></AppShell>;
  if (!shown) return preparing;
  const status = forThis && (app.analyzing || app.jobError || app.job?.state === 'cancelled') ? <StatusBox key={app.epoch.current} job={app.job} error={app.jobError} canCancel={Boolean(app.currentJob.current)} onCancel={() => void app.cancel()} /> : null;
  return <Suspense fallback={preparing}>
    <PullView key={`${target.key}@${shown.snapshot.headSHA}:${shown.guide?.key ?? ''}`} detail={shown} view={target.view} navigation={navigation} status={status} analyzing={forThis && app.analyzing}
      onDetail={update => app.setPull(current => current?.key === target.key ? { key: target.key, detail: update(current.detail) } : current)}
      onAnalyze={fresh => void app.analyze(target, fresh, shown.snapshot.files.map(file => file.path))} color={color} />
  </Suspense>;
}

function Preparing({ target, error, onRetry, color }: { target: PullTarget; error: string; onRetry: () => void; color: string }) {
  const pull = recall(target.repo, target.number);
  if (!error) return <PullSkeleton target={target} title={pull?.title} color={color} />;
  return <div className="preparing">
    <Link {...homeLink()} className="back-link"><ArrowLeft size={14} />Pull requests</Link>
    <div className="preparing-body">
      <span className="outline-repo"><RepoSwatch color={color} size={7} />{target.repo} #{target.number}</span>
      <h1>{pull ? <><PullIcon draft={pull.isDraft} state={pull.state} size={18} />{pull.title}</> : `Pull request #${target.number}`}</h1>
      <StatusBox job={null} error={error} canCancel={false} onCancel={() => {}} />
      <div className="preparing-actions"><Button onClick={onRetry}><RotateCw />Try again</Button><a className={buttonVariants({ variant: 'ghost', size: 'xs' })} href={target.url} target="_blank" rel="noreferrer">Open on GitHub<ExternalLink size={12} /></a></div>
    </div>
  </div>;
}

// The PR page's shape while it loads; the repo, number and any title seen in a list are already known, and the tabs already work.
function PullSkeleton({ target, title, color }: { target: PullTarget; title?: string; color: string }) {
  const tabs: [PullViewName, string][] = [['overview', 'Overview'], ['guide', 'Guide'], ['diff', 'Diff']];
  const lines = (widths: string[]) => <div className="flex flex-col gap-2.5">{widths.map((width, i) => <Skeleton key={i} className={`h-3 ${width}`} />)}</div>;
  const heading = <header className="pr-heading">
    {title ? <h1>{title}</h1> : <Skeleton className="mb-3 h-7 w-2/3" />}
    <div className="review-meta"><Skeleton className="size-[18px] rounded-full" /><Skeleton className="h-3 w-20" /><span className="meta-separator">·</span><span className="meta-repo"><RepoSwatch color={color} size={7} />{target.repo} #{target.number}</span></div>
  </header>;
  return <div className={`pr-page view-${target.view}`} aria-busy="true" aria-label="Loading the pull request">
    <header className="pr-topbar">
      <span className="topbar-title"><span className="topbar-number">#{target.number}</span>{title ? <span>{title}</span> : <Skeleton className="h-3.5 w-48 self-center" />}</span>
      <nav className="view-tabs" aria-label="View">{tabs.map(([name, label]) => <Link key={name} {...pullLink(target.repo, target.number, name)} className={target.view === name ? 'is-active' : ''}>{label}</Link>)}</nav>
      <div className="topbar-actions"><Skeleton className="h-7 w-28" /></div>
    </header>
    {target.view === 'overview' ? <div className="overview-layout">
        <div className="overview-main">{heading}{lines(['w-full', 'w-full', 'w-11/12', 'w-2/3'])}</div>
        <aside className="overview-side">{['w-24', 'w-36', 'w-28', 'w-32'].map((width, i) => <section key={i}><Skeleton className="h-3 w-16" /><Skeleton className={`h-4 ${width}`} /></section>)}</aside>
      </div>
      : target.view === 'guide' ? <div className="guide-page">
        <div className="guide-head">{heading}{lines(['w-3/4', 'w-1/2'])}</div>
        <div className="chapter-section"><div className="explanation">{lines(['w-2/3', 'w-full', 'w-full', 'w-4/5'])}</div><Skeleton className="h-96 w-full rounded-[10px]" /></div>
      </div>
      : <div className="diff-page">
        <div className="diff-toolbar"><Skeleton className="h-7 w-20" /><Skeleton className="h-3 w-32" /></div>
        <div className="diff-body"><div className="diff-panel">{[0, 1, 2].map(i => <Skeleton key={i} className="h-11 w-full rounded-[10px]" />)}</div></div>
      </div>}
  </div>;
}
