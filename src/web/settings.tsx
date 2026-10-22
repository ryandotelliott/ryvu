import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookMarked, Check, GripVertical, LoaderCircle, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { api, forgetIndex } from './api';
import { RepoSwatch, Segmented, Switch, Tip, repoColor } from './ui';
import type { PullPage, Settings } from '../types';

export function AddRepoForm({ onAdded, autoFocus }: { onAdded: (settings: Settings) => void; autoFocus?: boolean }) {
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!value.trim() || busy) return;
    setBusy(true); setError('');
    try { onAdded(await api<Settings>('/api/repos', { repo: value })); setValue(''); forgetIndex(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add that repository.'); }
    finally { setBusy(false); }
  }
  return <form className="add-repo" onSubmit={submit}>
    <div className="add-repo-row">
      <InputGroup className="h-9 flex-1 bg-card">
        <InputGroupAddon><BookMarked /></InputGroupAddon>
        <InputGroupInput aria-label="Repository" aria-invalid={Boolean(error)} value={value} onChange={e => { setValue(e.target.value); setError(''); }} placeholder="owner/repo or a GitHub URL" autoComplete="off" spellCheck={false} autoFocus={autoFocus} className="font-mono" />
      </InputGroup>
      <Button type="submit" size="lg" disabled={!value.trim() || busy}>{busy ? <LoaderCircle className="spinner" /> : <Plus />}{busy ? 'Checking' : 'Add'}</Button>
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
  </form>;
}

export function SettingsPage({ settings, onSettings }: { settings: Settings | null; onSettings: (settings: Settings) => void }) {
  const [counts, setCounts] = useState<NonNullable<PullPage['repos']>>([]), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null), savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if (settings?.repos.length) api<PullPage>('/api/pulls').then(page => setCounts(page.repos ?? [])).catch(() => setCounts([])); }, [settings?.repos.join('|')]);
  if (!settings) return <div className="settings"><h1>Settings</h1></div>;
  async function save(next: Settings) {
    const previous = settings!; onSettings(next); setError('');
    try {
      onSettings(await api<Settings>('/api/settings', next)); forgetIndex();
      setSaved(true); clearTimeout(savedTimer.current); savedTimer.current = setTimeout(() => setSaved(false), 1600);
    } catch (e) { onSettings(previous); setError(e instanceof Error ? e.message : 'Settings could not be saved.'); }
  }
  function move(repo: string, offset: number) {
    const repos = [...settings!.repos], from = repos.indexOf(repo), to = from + offset;
    if (to < 0 || to >= repos.length) return null;
    repos.splice(to, 0, ...repos.splice(from, 1)); return repos;
  }
  const describe = (repo: string) => {
    const count = counts.find(item => item.repo === repo);
    if (!count) return 'Loading…';
    return `${count.open} open${count.review ? ` · ${count.review} waiting on your review` : ''}`;
  };
  return <div className="settings">
    <header className="settings-heading"><h1>Settings</h1>{saved && <span className="saved" role="status"><Check size={13} />Saved</span>}</header>
    {error && <div className="notice" role="alert">{error}</div>}
    <section className="settings-section">
      <div className="section-intro"><h2>Repositories</h2><p>Open pull requests from these repositories appear on your home page. Drag to change their order in the sidebar.</p></div>
      <AddRepoForm onAdded={next => { onSettings(next); setSaved(true); }} />
      {settings.repos.length > 0 && <ul className="repo-list">
        {settings.repos.map(repo => <li key={repo} className={dragging === repo ? 'is-dragging' : ''} draggable
          onDragStart={event => { setDragging(repo); event.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={event => { event.preventDefault(); if (!dragging || dragging === repo) return; const repos = [...settings.repos], from = repos.indexOf(dragging), to = repos.indexOf(repo); repos.splice(to, 0, ...repos.splice(from, 1)); onSettings({ ...settings, repos }); }}
          onDragEnd={() => { setDragging(null); void save(settings); }}>
          <button type="button" className="drag-handle" aria-label={`Reorder ${repo}. Use the up and down arrow keys.`} onKeyDown={event => {
            const next = event.key === 'ArrowUp' ? move(repo, -1) : event.key === 'ArrowDown' ? move(repo, 1) : null;
            if (next) { event.preventDefault(); void save({ ...settings, repos: next }); requestAnimationFrame(() => (event.target as HTMLElement).focus()); }
          }}><GripVertical size={14} /></button>
          <RepoSwatch color={repoColor(settings.repos, repo)} size={10} />
          <div className="repo-text"><a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">{repo}</a><span>{describe(repo)}</span></div>
          <Tip content="Remove"><Button variant="ghost" size="icon" aria-label={`Remove ${repo}`} onClick={() => void save({ ...settings, repos: settings.repos.filter(value => value !== repo) })}><X size={14} /></Button></Tip>
        </li>)}
      </ul>}
    </section>
    <section className="settings-section">
      <div className="section-intro"><h2>Home page</h2></div>
      <div className="setting-row"><div><strong>Pull requests per load</strong><span>How many to fetch at a time as you scroll the home page.</span></div><Segmented label="Pull requests per load" value={String(settings.pageSize)} options={['10', '25', '50'].map(value => ({ value, label: value }))} onChange={value => void save({ ...settings, pageSize: Number(value) as Settings['pageSize'] })} /></div>
      <div className="setting-row"><div><strong>Show draft pull requests</strong><span>You can still toggle drafts from the filter bar.</span></div><Switch label="Show draft pull requests" checked={settings.showDrafts} onChange={showDrafts => void save({ ...settings, showDrafts })} /></div>
      <div className="setting-row"><div><strong>Show pull requests from bots</strong><span>Dependency updates from Renovate, Dependabot and similar accounts.</span></div><Switch label="Show pull requests from bots" checked={settings.showBots} onChange={showBots => void save({ ...settings, showBots })} /></div>
    </section>
  </div>;
}
