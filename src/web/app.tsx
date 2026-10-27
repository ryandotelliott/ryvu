import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ExternalLink, RotateCw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { listPulls, openSession } from '../inbox.functions';
import { cancelAnalysis, getAnalysis, startAnalysis } from '../jobs.functions';
import { getPull, getRange } from '../pull.functions';
import { setSessionToken } from '../session';
import { AppContext, useApplication } from './application-context';
import { recall, remember } from './browser-state';
import { hiddenPaths } from './file-filters';
import { InboxCache } from './inbox-cache';
import { homeLink, pullLink, type PullTarget } from './links';
import { CommandPalette } from './palette';
import { AppShell } from './shell';
import { PullSkeleton } from './pull-skeleton';
import { rangeLabel } from './pull-page';
import { SidebarProvider } from '@/components/ui/sidebar';
import { PullIcon, StatusBox } from './ui';
import type { JobView, PullDetail, PullPage as PullList, Settings } from '../types';

const loadPullView = () => import('./pull');
const PullView = lazy(() => loadPullView().then(module => ({ default: module.PullView })));

function useAppState() {
  const [inbox] = useState(() => new InboxCache(query => listPulls({ data: query })));
  const [connection, setConnection] = useState<'connecting' | 'ready' | 'offline'>('connecting');
  const [settings, setSettings] = useState<Settings | null>(null), [repoCounts, setRepoCounts] = useState<Record<string, number> | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pulls, setPulls] = useState<Record<string, PullDetail>>({}), [loadError, setLoadError] = useState(''), loadSequence = useRef(0);
  const [confirmedPull, setConfirmedPull] = useState<{ key: string; version: number } | null>(null);
  const isPullConfirmed = (key: string) => confirmedPull?.key === key && confirmedPull.version === loadSequence.current;
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
    const version = ++loadSequence.current, previous = pulls[next.key];
    setLoadError('');
    try {
      const detail = next.through ? await getRange({ data: { repo: next.repo, number: next.number, through: next.through } }) : await getPull({ data: { repo: next.repo, number: next.number } });
      if (version === loadSequence.current) {
        remember([
          ...(detail.stack?.pulls ?? []).map(pull => ({ repo: next.repo, number: pull.number, title: pull.title, state: pull.state, isDraft: pull.draft, additions: pull.additions, deletions: pull.deletions, stack: detail.stack })),
          // A range's snapshot is the combined diff, not this PR's, so only the stack rows describe its PRs.
          ...(detail.range ? [] : [{ repo: next.repo, number: next.number, title: detail.snapshot.title, author: detail.snapshot.author, state: detail.snapshot.state, isDraft: detail.snapshot.draft, stack: detail.stack }])
        ]);
        setPulls(current => ({ ...current, [next.key]: current[next.key] === previous ? detail : current[next.key] }));
        setConfirmedPull({ key: next.key, version });
      }
    } catch (e) { if (version === loadSequence.current) setLoadError(e instanceof Error ? e.message : 'Could not load the pull request.'); }
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
          setPulls(current => current[next.key] ? { ...current, [next.key]: { ...current[next.key], snapshot: result.snapshot, guide: result, prior: null } } : current);
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
  return { inbox, connection, settings, setSettings, repoCounts, onPage, paletteOpen, setPaletteOpen, openPalette: () => setPaletteOpen(true), pulls, setPulls, loadError, load, confirmedPull, isPullConfirmed, job, jobError, jobKey, analyzing, epoch, currentJob, analyze, cancel };
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
    void app.load(target);
  }, [target.key, app.connection]);
  const shown = app.pulls[target.key] ?? null;
  // ?analyze=1 (from search) starts analysis once the PR has loaded, then drops the flag.
  useEffect(() => {
    if (!target.analyze || !shown || !app.isPullConfirmed(target.key)) return;
    void navigate({ ...pullLink(target.repo, target.number, 'guide'), replace: true });
    if (!shown.guide && !(app.analyzing && app.jobKey === target.key)) void app.analyze(target, false, shown.snapshot.files.map(file => file.path));
  }, [target.key, target.analyze, Boolean(shown), app.confirmedPull]);
  useEffect(() => { document.title = shown ? `${shown.range ? rangeLabel(shown.range) : shown.snapshot.title} · PR Guide` : 'Loading · PR Guide'; }, [shown, target.key]);
  const forThis = app.jobKey === target.key;
  const navigation = { settings: app.settings, repoCounts: app.repoCounts, onSearch: app.openPalette };
  const preparing = <Preparing target={target} navigation={navigation} error={app.loadError} onRetry={() => void app.load(target)} />;
  if (!shown) return preparing;
  const status = forThis && (app.analyzing || app.jobError || app.job?.state === 'cancelled') ? <StatusBox key={app.epoch.current} job={app.job} error={app.jobError} canCancel={Boolean(app.currentJob.current)} onCancel={() => void app.cancel()} /> : null;
  return <Suspense fallback={preparing}>
    <PullView key={`${target.key}@${shown.snapshot.headSHA}:${shown.guide?.key ?? ''}`} detail={shown} view={target.view} through={target.through} browsing={{ branch: target.branch, path: target.path }} navigation={navigation} status={status} analyzing={forThis && app.analyzing}
      onDetail={update => app.setPulls(current => current[target.key] ? { ...current, [target.key]: update(current[target.key]) } : current)}
      onAnalyze={fresh => void app.analyze(target, fresh, shown.snapshot.files.map(file => file.path))} />
  </Suspense>;
}

function Preparing({ target, navigation, error, onRetry }: { target: PullTarget; navigation: ComponentProps<typeof PullSkeleton>['navigation']; error: string; onRetry: () => void }) {
  const pull = recall(target.repo, target.number);
  if (!error) return <PullSkeleton target={target} pull={pull} navigation={navigation} />;
  return <AppShell {...navigation}><div className="preparing">
    <Link {...homeLink()} className="back-link"><ArrowLeft size={14} />Pull requests</Link>
    <div className="preparing-body">
      <span className="outline-repo">{target.repo} #{target.number}</span>
      <h1>{pull ? <><PullIcon draft={pull.isDraft} state={pull.state} size={18} />{pull.title}</> : `Pull request #${target.number}`}</h1>
      <StatusBox job={null} error={error} canCancel={false} onCancel={() => {}} />
      <div className="preparing-actions"><Button onClick={onRetry}><RotateCw />Try again</Button><a className={buttonVariants({ variant: 'ghost', size: 'xs' })} href={target.url} target="_blank" rel="noreferrer">Open on GitHub<ExternalLink size={12} /></a></div>
    </div>
  </div></AppShell>;
}
