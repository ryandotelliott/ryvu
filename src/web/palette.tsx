import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen, CornerDownLeft, ExternalLink, GitPullRequest, Link2, LoaderCircle, Settings as SettingsIcon } from 'lucide-react';
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { listPullIndex, resolvePull } from '../inbox.functions';
import { pullIndex, pullKey, remember, type KnownPull } from './browser-state';
import { fuzzy, segments } from './fuzzy';
import { homeLink, pullLink, settingsLink } from './links';
import { commandKey } from './shell';
import { Highlighted, Kbd, PullIcon, RepoSwatch, repoColor } from './ui';
import type { IndexedPull, Resolution, Settings } from '../types';

type Target = { repo: string; number: number };
type Item =
  | { id: string; kind: 'pull'; pull: KnownPull; title?: number[] }
  | { id: string; kind: 'goto'; target: Target }
  | { id: string; kind: 'action'; label: string; icon: ReactNode; hint?: ReactNode; run: () => void };
type Group = { label: ReactNode; meta?: string; items: Item[]; note?: ReactNode };
const looksLikeReference = (query: string) => /^\s*#?[1-9]\d{0,9}\s*$/.test(query) || /github\.com\//i.test(query) || /^\s*[\w.-]+\/[\w.-]+#\d+\s*$/.test(query);
const keyOf = (target: Target) => pullKey(target.repo, target.number);
// The PRs a link or number points at, known without asking GitHub, so Enter can open one right away.
function targetsFor(query: string, repos: string[]): Target[] {
  const value = query.trim().replace(/^#/, '');
  const link = value.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pulls?\/([1-9]\d{0,9})/i) ?? value.match(/^([\w.-]+)\/([\w.-]+)#([1-9]\d{0,9})$/);
  if (link) return [{ repo: `${link[1]}/${link[2]}`, number: Number(link[3]) }];
  return /^[1-9]\d{0,9}$/.test(value) ? repos.map(repo => ({ repo, number: Number(value) })) : [];
}
function merge(current: KnownPull[] | null, found: IndexedPull[]): KnownPull[] {
  const seen = new Set((current ?? []).map(keyOf));
  return [...(current ?? []), ...found.filter(pull => !seen.has(keyOf(pull)))];
}

export function CommandPalette({ open, onOpenChange, settings }: { open: boolean; onOpenChange: (open: boolean) => void; settings: Settings | null }) {
  const [query, setQuery] = useState(''), [pulls, setPulls] = useState<KnownPull[] | null>(null);
  const [resolution, setResolution] = useState<{ query: string; result: Resolution | null; error?: string } | null>(null);
  // Title matches from GitHub for the typed words, beyond the page loaded when the palette opened.
  const [remote, setRemote] = useState<{ query: string; keys: string[] | null } | null>(null);
  const reference = looksLikeReference(query), repos = settings?.repos ?? [], trimmed = query.trim(), navigate = useNavigate();
  useEffect(() => { if (!open) return; setQuery(''); pullIndex().then(setPulls).catch(() => setPulls([])); }, [open]);
  useEffect(() => {
    if (!reference) { setResolution(null); return; }
    setResolution({ query: trimmed, result: null });
    const timer = setTimeout(() => {
      resolvePull({ data: { q: trimmed } })
        .then(result => { remember(result.items); setResolution(current => current?.query === trimmed ? { query: trimmed, result } : current); })
        .catch(e => setResolution(current => current?.query === trimmed ? { query: trimmed, result: null, error: e instanceof Error ? e.message : 'Lookup failed.' } : current));
    }, 140);
    return () => clearTimeout(timer);
  }, [trimmed, reference]);
  useEffect(() => {
    if (!open || reference || trimmed.length < 2) { setRemote(null); return; }
    setRemote({ query: trimmed, keys: null });
    const timer = setTimeout(() => {
      listPullIndex({ data: { q: trimmed } })
        .then(found => { remember(found); setPulls(current => merge(current, found)); setRemote(current => current?.query === trimmed ? { query: trimmed, keys: found.map(keyOf) } : current); })
        .catch(() => setRemote(current => current?.query === trimmed ? { query: trimmed, keys: [] } : current));
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmed, reference, open]);
  const close = () => onOpenChange(false);
  const openPull = ({ repo, number }: Target, mode: 'open' | 'github' | 'guide' = 'open') => {
    close();
    if (mode === 'github') window.open(`https://github.com/${repo}/pull/${number}`, '_blank', 'noreferrer'); else void navigate(pullLink(repo, number, mode === 'guide' ? 'guide' : 'overview', mode === 'guide'));
  };
  const groups = useMemo<Group[]>(() => {
    if (!trimmed) return [
      { label: 'Recently updated', items: (pulls ?? []).slice(0, 6).map(pull => ({ id: `recent:${keyOf(pull)}`, kind: 'pull' as const, pull })) },
      { label: 'Go to', items: [
        { id: 'go:home', kind: 'action', label: 'Pull requests', icon: <GitPullRequest size={14} />, run: () => { close(); void navigate(homeLink()); } },
        { id: 'go:settings', kind: 'action', label: 'Settings', icon: <SettingsIcon size={14} />, run: () => { close(); void navigate(settingsLink); } }
      ] }
    ];
    if (reference) {
      const result = resolution?.result, isLink = !/^\s*#?\d+\s*$/.test(trimmed), number = trimmed.replace(/^#/, '');
      // Until the lookup answers (or if it fails), each candidate opens directly; its row keeps the same id once the title arrives.
      const items: Item[] = result ? result.items.map(pull => ({ id: `ref:${keyOf(pull)}`, kind: 'pull', pull })) : targetsFor(trimmed, repos).map(target => ({ id: `ref:${keyOf(target)}`, kind: 'goto', target }));
      if (isLink && result?.items.length === 1) {
        const pull = result.items[0];
        items.push({ id: 'ref:github', kind: 'action', label: 'Open on GitHub', icon: <ExternalLink size={14} />, hint: <Kbd>{commandKey}↵</Kbd>, run: () => openPull(pull, 'github') });
        items.push({ id: 'ref:guide', kind: 'action', label: pull.guide ? 'Open guide' : 'Analyze and open guide', icon: <BookOpen size={14} />, hint: <Kbd>⇧↵</Kbd>, run: () => openPull(pull, 'guide') });
      }
      const note = resolution?.error || result?.error ? resolution?.error ?? result?.error
        : result && !items.length ? (isLink ? 'That link doesn’t point to a pull request this account can read.' : repos.length ? `No pull request #${number} in your repositories.` : 'Add repositories in Settings to look up PRs by number.') : undefined;
      return [{ label: isLink ? <><Link2 size={12} />Recognized pull request link</> : <>Pull request #{number}</>, items, note }];
    }
    const scored = (pulls ?? []).flatMap(pull => {
      const match = fuzzy(trimmed, [pull.title, `${pull.repo}#${pull.number}`, pull.author], [1, 0.9, 0.7]);
      return match ? [{ pull, match }] : [];
    }).sort((a, b) => b.match.score - a.match.score);
    // GitHub matches words anywhere in the title, so keep its results even when the local fuzzy match is stricter.
    const matched = new Set(scored.map(({ pull }) => keyOf(pull))), found = remote?.query === trimmed ? remote.keys : null;
    const extra = (pulls ?? []).filter(pull => found?.includes(keyOf(pull)) && !matched.has(keyOf(pull)));
    const items: Item[] = [...scored.slice(0, 20).map(({ pull, match }) => ({ id: `match:${keyOf(pull)}`, kind: 'pull' as const, pull, title: match.fields[0] })), ...extra.map(pull => ({ id: `match:${keyOf(pull)}`, kind: 'pull' as const, pull }))].slice(0, 20);
    const searching = remote?.query === trimmed && !remote.keys;
    return [{ label: 'Pull requests', meta: pulls ? `${items.length} ${items.length === 1 ? 'match' : 'matches'}` : undefined, items,
      note: !pulls ? <><LoaderCircle size={14} className="spinner" />Loading pull requests…</> : searching ? <><LoaderCircle size={14} className="spinner" />Searching all open pull requests…</> : !items.length ? `No open pull requests match “${trimmed}”.` : undefined }];
  }, [trimmed, pulls, resolution, remote, reference, repos.join('|')]);
  // cmdk tracks the highlighted row by value; keep it on the first result as the results change.
  const items = groups.flatMap(group => group.items), [value, setValue] = useState('');
  useEffect(() => { if (!items.some(item => item.id === value)) setValue(items[0]?.id ?? ''); }, [items.map(item => item.id).join('|')]);
  useEffect(() => { setValue(items[0]?.id ?? ''); }, [query]);
  function onKeyDown(event: KeyboardEvent) {
    // Plain Enter goes through cmdk's onSelect; the modifier variants are handled here.
    const item = items.find(entry => entry.id === value);
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey || event.shiftKey) || !item || item.kind === 'action') return;
    event.preventDefault(); openPull(item.kind === 'pull' ? item.pull : item.target, event.metaKey || event.ctrlKey ? 'github' : 'guide');
  }
  return <CommandDialog open={open} onOpenChange={onOpenChange} title="Find a pull request" description="Search pull requests, or paste a link or number" className="top-[12vh] sm:max-w-[640px]">
    <Command shouldFilter={false} value={value} onValueChange={setValue} onKeyDown={onKeyDown} className="p-0">
      <CommandInput autoFocus value={query} onValueChange={setQuery} placeholder="Search pull requests, or paste a link or number" spellCheck={false} autoComplete="off" className={reference ? 'font-mono text-[13px]' : ''} />
      <CommandList className="max-h-[min(60vh,520px)] p-1">
        {groups.map((group, g) => (group.items.length > 0 || group.note) && <CommandGroup key={g} heading={<span className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1">{group.label}</span>{group.meta && <span>{group.meta}</span>}</span>}>
          {group.items.map(item => <CommandItem key={item.id} value={item.id} onSelect={() => item.kind === 'action' ? item.run() : openPull(item.kind === 'pull' ? item.pull : item.target)} className="palette-item gap-3 rounded-lg px-2.5 py-2">
            {item.kind === 'pull' ? <>
              <span className="palette-icon"><PullIcon draft={item.pull.isDraft} state={item.pull.state} size={16} /></span>
              <span className="palette-text">
                <span className="palette-title"><Highlighted runs={segments(item.pull.title, item.title)} /></span>
                <span className="palette-meta"><RepoSwatch color={repoColor(repos, item.pull.repo)} size={7} />{item.pull.repo} #{item.pull.number} · {item.pull.author}{item.pull.state && item.pull.state !== 'open' ? ` · ${item.pull.state}` : item.pull.isDraft ? ' · draft' : ''}{item.pull.reviewRequested ? ' · review requested' : ''}</span>
              </span>
              <span className="palette-hint">Open<Kbd><CornerDownLeft /></Kbd></span>
            </> : item.kind === 'goto' ? <>
              <span className="palette-icon"><PullIcon size={16} /></span>
              <span className="palette-text">
                <span className="palette-title">Go to {item.target.repo} #{item.target.number}</span>
                <span className="palette-meta"><RepoSwatch color={repoColor(repos, item.target.repo)} size={7} />{resolution?.error ? 'Title unavailable' : <><LoaderCircle size={11} className="spinner" />Looking up the title…</>}</span>
              </span>
              <span className="palette-hint">Open<Kbd><CornerDownLeft /></Kbd></span>
            </> : <>
              <span className="palette-icon">{item.icon}</span><span className="palette-text"><span className="palette-label">{item.label}</span></span>{item.hint}
            </>}
          </CommandItem>)}
          {group.note && <div className="palette-note">{group.note}</div>}
        </CommandGroup>)}
      </CommandList>
      <footer className="palette-footer"><span>Paste a link, type 9229 or #9229, or search titles and authors</span><span className="palette-keys"><span>↑↓ move</span><span>↵ open</span><span>⇧↵ guide</span><span>{commandKey}↵ GitHub</span></span></footer>
    </Command>
  </CommandDialog>;
}
