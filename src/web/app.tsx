import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ExternalLink, RotateCw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api, connect, recall } from './api';
import { hiddenPaths } from './file-filters';
import { CommandPalette } from './palette';
import { Home } from './home';
import { PullView } from './pull';
import { navigate, prHref, useRoute, type PullViewName, type Route } from './routes';
import { SettingsPage } from './settings';
import { AppShell } from './shell';
import { PullIcon, RepoSwatch, StatusBox, Tip, repoColor } from './ui';
import type { JobView, PullDetail, Settings } from '../types';
import './style.css';

type Target = { key: string; view: PullViewName; url: string; repo: string; number: number; analyze: boolean };
function targetFor(route: Route): Target | null {
  if (route.name !== 'pr') return null;
  const repo = `${route.owner}/${route.repo}`;
  return { key: `${repo.toLowerCase()}#${route.number}`, view: route.view, url: `https://github.com/${repo}/pull/${route.number}`, repo, number: route.number, analyze: route.analyze };
}
function App() {
  const route = useRoute(), target = targetFor(route);
  const [connection, setConnection] = useState<'connecting' | 'ready' | 'offline'>('connecting');
  const [settings, setSettings] = useState<Settings | null>(null), [repoCounts, setRepoCounts] = useState<Record<string, number> | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The PR being read, loaded without analysis.
  const [pull, setPull] = useState<{ key: string; detail: PullDetail } | null>(null), [loadError, setLoadError] = useState(''), loading = useRef<string | null>(null);
  // The analysis job; it keeps running if you navigate elsewhere.
  const [job, setJob] = useState<JobView | null>(null), [jobError, setJobError] = useState(''), [jobKey, setJobKey] = useState<string | null>(null);
  const client = useRef(crypto.randomUUID()), sequence = useRef(0), epoch = useRef(0), currentJob = useRef<string | null>(null);
  const analyzing = job?.state === 'loading' || job?.state === 'generating';
  useEffect(() => {
    connect().then(() => { setConnection('ready'); return api<Settings>('/api/settings'); }).then(setSettings).catch(() => setConnection('offline'));
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(open => !open); } };
    window.addEventListener('keydown', onKey);
    return () => { epoch.current++; window.removeEventListener('keydown', onKey); };
  }, []);
  async function load(next: Target) {
    loading.current = next.key; setLoadError('');
    try {
      const detail = await api<PullDetail>(`/api/pull?repo=${encodeURIComponent(next.repo)}&number=${next.number}`);
      if (loading.current === next.key) setPull({ key: next.key, detail });
    } catch (e) { if (loading.current === next.key) setLoadError(e instanceof Error ? e.message : 'Could not load the pull request.'); }
  }
  // Files hidden by the reviewer's filters are left out of the analysis.
  async function analyze(next: Target, fresh: boolean, paths: string[]) {
    const version = ++epoch.current; currentJob.current = null; setJobError(''); setJobKey(next.key);
    setJob({ id: '', state: 'loading', message: 'Reading the pull request…' });
    try {
      let value: JobView = await api('/api/jobs', { clientId: client.current, sequence: ++sequence.current, url: next.url, fresh, ignored: hiddenPaths(next.repo, paths) });
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
        value = await api(`/api/jobs/${value.id}`);
      }
    } catch (e) { if (version === epoch.current) { setJobError(e instanceof Error ? e.message : 'Request failed.'); setJob(null); } }
  }
  async function cancel() {
    // Keep waiting for the job id if the initial POST is still in flight.
    const id = currentJob.current;
    if (!id) return;
    ++epoch.current;
    try { setJob(await api(`/api/jobs/${id}/cancel`, { clientId: client.current })); currentJob.current = null; }
    catch (e) { setJobError(e instanceof Error ? e.message : 'Cancellation failed.'); setJob(null); }
  }
  useEffect(() => {
    if (connection !== 'ready' || !target) return;
    if (pull?.key !== target.key && loading.current !== target.key) void load(target);
  }, [target?.key, connection]);
  // ?analyze=1 (from search) starts analysis once the PR has loaded, then drops the flag.
  const shown = pull && target && pull.key === target.key ? pull.detail : null;
  useEffect(() => {
    if (!target || !target.analyze || !shown) return;
    navigate(prHref(target.repo, target.number, 'guide'), true);
    if (!shown.guide && !(analyzing && jobKey === target.key)) void analyze(target, false, shown.snapshot.files.map(file => file.path));
  }, [target?.key, target?.analyze, Boolean(shown)]);
  useEffect(() => {
    document.title = shown ? `${shown.snapshot.title} · PR Guide` : route.name === 'settings' ? 'Settings · PR Guide' : target ? 'Loading · PR Guide' : 'Pull requests · PR Guide';
  }, [shown, route.name, target?.key]);
  const palette = <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} settings={settings} />;
  if (target) {
    const forThis = jobKey === target.key;
    const status = forThis && (analyzing || jobError || job?.state === 'cancelled') ? <StatusBox key={epoch.current} job={job} error={jobError} canCancel={Boolean(currentJob.current)} onCancel={() => void cancel()} /> : null;
    return <>
      {shown ? <PullView key={`${target.key}@${shown.snapshot.headSHA}:${shown.guide?.key ?? ''}`} detail={shown} view={target.view} status={status} analyzing={forThis && analyzing}
          onDetail={update => setPull(current => current?.key === target.key ? { key: target.key, detail: update(current.detail) } : current)}
          onAnalyze={fresh => void analyze(target, fresh, shown.snapshot.files.map(file => file.path))}
          color={repoColor(settings?.repos ?? [], target.repo)} />
        : <Preparing target={target} error={loadError} onRetry={() => { loading.current = null; void load(target); }} settings={settings} />}
      {palette}
    </>;
  }
  const selectedRepo = route.name === 'home' ? route.params.get('repo') ?? undefined : undefined;
  return <>
    <AppShell active={route.name === 'settings' ? 'settings' : 'home'} settings={settings} repoCounts={repoCounts} selectedRepo={selectedRepo} onSearch={() => setPaletteOpen(true)}>
      {route.name === 'settings' ? <SettingsPage settings={settings} onSettings={setSettings} />
        : <Home params={route.name === 'home' ? route.params : new URLSearchParams()} settings={settings} onSettings={setSettings} onPage={page => { if (page.repos) setRepoCounts(Object.fromEntries(page.repos.map(repo => [repo.repo, repo.open]))); }} />}
    </AppShell>
    {palette}
  </>;
}

function Preparing({ target, error, onRetry, settings }: { target: Target; error: string; onRetry: () => void; settings: Settings | null }) {
  const pull = recall(target.repo, target.number), color = repoColor(settings?.repos ?? [], target.repo);
  if (!error) return <PullSkeleton target={target} title={pull?.title} color={color} />;
  return <div className="preparing">
    <a href="/" className="back-link"><ArrowLeft size={14} />Pull requests</a>
    <div className="preparing-body">
      <span className="outline-repo"><RepoSwatch color={color} size={7} />{target.repo} #{target.number}</span>
      <h1>{pull ? <><PullIcon draft={pull.isDraft} state={pull.state} size={18} />{pull.title}</> : `Pull request #${target.number}`}</h1>
      <StatusBox job={null} error={error} canCancel={false} onCancel={() => {}} />
      <div className="preparing-actions"><Button onClick={onRetry}><RotateCw />Try again</Button><a className={buttonVariants({ variant: 'ghost', size: 'xs' })} href={target.url} target="_blank" rel="noreferrer">Open on GitHub<ExternalLink size={12} /></a></div>
    </div>
  </div>;
}

// The PR page's shape while it loads; the repo, number and any title seen in a list are already known, and the tabs already work.
function PullSkeleton({ target, title, color }: { target: Target; title?: string; color: string }) {
  const tabs: [PullViewName, string][] = [['overview', 'Overview'], ['guide', 'Guide'], ['diff', 'Diff']];
  const lines = (widths: string[]) => <div className="flex flex-col gap-2.5">{widths.map((width, i) => <Skeleton key={i} className={`h-3 ${width}`} />)}</div>;
  const heading = <header className="pr-heading">
    {title ? <h1>{title}</h1> : <Skeleton className="mb-3 h-7 w-2/3" />}
    <div className="review-meta"><Skeleton className="size-[18px] rounded-full" /><Skeleton className="h-3 w-20" /><span className="meta-separator">·</span><span className="meta-repo"><RepoSwatch color={color} size={7} />{target.repo} #{target.number}</span></div>
  </header>;
  return <div className={`pr-page view-${target.view}`} aria-busy="true" aria-label="Loading the pull request">
    <header className="pr-topbar">
      <Tip content="Pull requests" side="bottom"><a href="/" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} aria-label="Pull requests"><ArrowLeft /></a></Tip>
      <span className="topbar-title"><span className="topbar-number">#{target.number}</span>{title ? <span>{title}</span> : <Skeleton className="h-3.5 w-48 self-center" />}</span>
      <nav className="view-tabs" aria-label="View">{tabs.map(([name, label]) => <a key={name} href={prHref(target.repo, target.number, name)} className={target.view === name ? 'is-active' : ''}>{label}</a>)}</nav>
      <div className="topbar-actions"><Skeleton className="h-7 w-28" /></div>
    </header>
    {target.view === 'overview' ? <div className="overview-layout">
        <main className="overview-main">{heading}{lines(['w-full', 'w-full', 'w-11/12', 'w-2/3'])}</main>
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

createRoot(document.getElementById('root')!).render(<TooltipProvider><App /></TooltipProvider>);
