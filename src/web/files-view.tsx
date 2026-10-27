import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, FileCode2, GitBranch, LoaderCircle } from 'lucide-react';
import { File } from '@pierre/diffs/react';
import { DEFAULT_VIRTUAL_FILE_METRICS, VirtualizedFile, type FileOptions } from '@pierre/diffs';
import { FileTree, useFileTree } from '@pierre/trees/react';
import type { GitStatus } from '@pierre/trees';
import { Button, buttonVariants } from '@/components/ui/button';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox';
import { SidebarGroup, SidebarGroupLabel } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { readFile } from '../pull.functions';
import { compareBranch, listBranches, readTree } from '../repo.functions';
import { readStored, writeStored } from './browser-state';
import { FileCount } from './diff';
import { lineHeightFor, type DisplaySettings } from './display';
import { codeTheme, pullBranches, scrollPageBy, splitPath } from './pull-page';
import { ErrorBoundary, Switch, Tip } from './ui';
import type { BranchChanges, BranchList, ChangedFile, RepoTree, Snapshot } from '../types';

type Loaded<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; message: string };
const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';

// Requests for Files, shared by the sidebar and the file pane and kept for the session. Trees, files and comparisons are
// keyed by commit, so they never go stale; a branch's list entry and current commit are read once per session.
const requests = new Map<string, Promise<unknown>>(), values = new Map<string, unknown>();
function useLoaded<T>(key: string | null, load: () => Promise<T>): Loaded<T> & { retry: () => void } {
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null), [, setSettled] = useState(0), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key || values.has(key)) return;
    let active = true, request = requests.get(key);
    if (!request) {
      request = load(); requests.set(key, request);
      request.then(value => { if (values.size > 100) values.delete(values.keys().next().value!); values.set(key, value); }, () => requests.delete(key));
    }
    request.then(() => { if (active) setSettled(count => count + 1); }, error => { if (active) setFailure({ key, message: message(error) }); });
    return () => { active = false; };
  }, [key, attempt]);
  const retry = () => { setFailure(null); setAttempt(count => count + 1); };
  if (key && values.has(key)) return { status: 'ready', value: values.get(key) as T, retry };
  if (key && failure?.key === key) return { status: 'error', message: failure.message, retry };
  return { status: 'loading', retry };
}

// What Files shows for one branch: its files, and its changes against the default branch's current commit. The PR's own branches are
// pinned to the commits under review, so the old and new files match the diff, and the PR's head shows the PR's own changes.
function useBrowse(snapshot: Snapshot, branch: string | null) {
  const repo = `${snapshot.identity.owner}/${snapshot.identity.repo}`, pull = pullBranches(snapshot);
  const branches = useLoaded<BranchList>(`branches:${repo}`, () => listBranches({ data: { repo } }));
  const defaultBranch = branches.status === 'ready' ? branches.value.defaultBranch : null;
  const name = branch ?? defaultBranch?.name ?? null;
  const pinned = (value: string) => value === pull.head ? snapshot.headSHA : value === pull.base ? snapshot.baseSHA : null;
  const ref = name ? pinned(name) ?? name : null;
  const tree = useLoaded<RepoTree>(ref && `tree:${repo}@${ref}`, () => readTree({ data: { repo, ref: ref! } }));
  const sha = tree.status === 'ready' ? tree.value.sha : null, base = defaultBranch?.sha ?? null;
  const inPull = name === pull.head, isDefault = Boolean(defaultBranch) && name === defaultBranch!.name;
  const compareKey = !inPull && !isDefault && sha && base && sha !== base ? `compare:${repo}:${base}...${sha}` : null;
  const compared = useLoaded<BranchChanges>(compareKey, () => compareBranch({ data: { repo, base: base!, head: sha! } }));
  let changes: (Loaded<BranchChanges> & { retry?: () => void }) | null = null;
  if (inPull) changes = { status: 'ready', value: { files: snapshot.files, truncated: false } };
  else if (compareKey) changes = compared;
  else if (!isDefault && (tree.status === 'loading' || branches.status === 'loading')) changes = { status: 'loading' };
  return { repo, pull, branches, defaultBranch, name, tree, sha, changes, inPull, against: inPull ? pull.base : defaultBranch?.name ?? '' };
}
type Browse = ReturnType<typeof useBrowse>;
const unchanged: ChangedFile[] = [], changeList = (browse: Browse) => browse.changes?.status === 'ready' ? browse.changes.value.files : unchanged;

const statuses: Record<string, GitStatus> = { added: 'added', removed: 'deleted', renamed: 'renamed' };
const colors = { added: 'var(--added)', removed: 'var(--removed)' };
const changedOnlyKey = 'pr-guide:files-changed-only';
const ancestors = (path: string) => path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'));

// The Files sidebar: a branch picker over the repository's whole tree. On a branch with changes, changed files show their line counts
// and can be listed alone. `search` and `field` are the page's file search button and input, shared with the other views.
export function RepoFiles({ snapshot, branch, path, filter, search, field, onBranch, onPick }: { snapshot: Snapshot; branch: string | null; path: string | null; filter: string; search: ReactNode; field: ReactNode; onBranch: (name: string) => void; onPick: (path: string) => void }) {
  const browse = useBrowse(snapshot, branch), files = changeList(browse);
  const [changedOnly, setChangedOnly] = useState(() => readStored<unknown>(changedOnlyKey, false) === true);
  useEffect(() => { writeStored(changedOnlyKey, changedOnly); }, [changedOnly]);
  const tree = browse.tree.status === 'ready' ? browse.tree.value : null, onlyChanged = changedOnly && files.length > 0;
  // Deleted files aren't in the branch's tree, but they are among its changes.
  const paths = useMemo(() => !tree ? [] : onlyChanged ? files.map(file => file.path) : [...tree.paths, ...files.filter(file => file.status === 'removed').map(file => file.path)], [tree, files, onlyChanged]);
  const additions = files.reduce((sum, file) => sum + file.additions, 0), deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return <SidebarGroup className="file-tree repo-files min-h-0 flex-1" aria-label="Repository files">
    <SidebarGroupLabel>Files {tree ? <span className="ml-2 tabular-nums">{paths.length.toLocaleString()}</span> : <Skeleton className="ml-2 h-3 w-5" />}</SidebarGroupLabel>
    {search}
    <BranchPicker repo={browse.repo} current={browse.name} defaultName={browse.defaultBranch?.name ?? null} pull={browse.pull} onPick={onBranch} />
    {browse.changes && <div className="branch-changes">
      {browse.changes.status === 'loading' ? <span className="branch-changes-text"><LoaderCircle size={12} className="spinner" />Comparing with {browse.against || 'the default branch'}…</span>
        : browse.changes.status === 'error' ? <span className="branch-changes-text is-error">Couldn’t compare with {browse.against}.<Button variant="link" size="xs" className="h-auto p-0" onClick={browse.changes.retry}>Retry</Button></span>
        : files.length ? <>
          <span className="branch-changes-text">{files.length.toLocaleString()}{browse.changes.value.truncated ? '+' : ''} changed {browse.inPull ? 'in this PR' : `against ${browse.against}`}<span className="added">+{additions.toLocaleString()}</span><span className="removed">−{deletions.toLocaleString()}</span></span>
          <label className="branch-changes-toggle">Only changed files<Switch label="Only show changed files" checked={changedOnly} onChange={setChangedOnly} /></label>
        </> : <span className="branch-changes-text">No changes against {browse.against}</span>}
    </div>}
    {browse.changes?.status === 'ready' && browse.changes.value.truncated && <p className="files-note">GitHub lists only the first 300 changed files.</p>}
    {field}
    {tree ? <>
      {/* The tree reads its files, statuses and counts once, so it is rebuilt when the comparison arrives. */}
      <RepoFileTree key={`${tree.sha}:${onlyChanged}:${browse.changes?.status ?? 'none'}`} paths={paths} changes={files} current={path} search={filter} open={onlyChanged} onPick={onPick} />
      {tree.truncated && <p className="files-note">This repository is too large for GitHub to list every file.</p>}
    </> : browse.tree.status === 'error' || browse.branches.status === 'error' ? <div className="files-note is-error">
      <span>{browse.tree.status === 'error' ? browse.tree.message : browse.branches.status === 'error' ? `Couldn’t list branches. ${browse.branches.message}` : ''}</span>
      <Button variant="outline" size="xs" onClick={() => { browse.branches.retry(); browse.tree.retry(); }}>Retry</Button>
    </div> : <div className="overflow-hidden" aria-hidden="true">{['w-28', 'w-36', 'w-24', 'w-32', 'w-40', 'w-28'].map((width, index) => <div key={index} className="list-file"><Skeleton className="size-3.5" /><Skeleton className={`h-3 max-w-full ${width}`} /></div>)}</div>}
  </SidebarGroup>;
}

// Recent branches, newest commit first, after the default branch and the PR's two sides. Typing searches every branch on GitHub.
function BranchPicker({ repo, current, defaultName, pull, onPick }: { repo: string; current: string | null; defaultName: string | null; pull: { base: string; head: string }; onPick: (name: string) => void }) {
  const [query, setQuery] = useState(''), [search, setSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 200); return () => clearTimeout(timer); }, [query]);
  const recent = useLoaded<BranchList>(`branches:${repo}`, () => listBranches({ data: { repo } }));
  const found = useLoaded<BranchList>(search ? `branches:${repo}:${search}` : null, () => listBranches({ data: { repo, query: search } }));
  const notes = new Map<string, string>([...(defaultName ? [[defaultName, 'default'] as const] : []), ...(pull.base ? [[pull.base, defaultName === pull.base ? 'default · base' : 'base'] as const] : []), [pull.head, 'this PR']]);
  const known = [...notes.keys(), ...(recent.status === 'ready' ? recent.value.branches.map(branch => branch.name) : [])];
  const typed = query.trim().toLowerCase();
  const names = [...new Set(typed ? [...known.filter(name => name.toLowerCase().includes(typed)), ...(found.status === 'ready' && search === query.trim() ? found.value.branches.map(branch => branch.name) : [])] : known)];
  const searching = Boolean(typed) && (search !== query.trim() || found.status === 'loading');
  return <Combobox items={names} filter={null} value={current} inputValue={query} onInputValueChange={setQuery} onOpenChange={open => { if (!open) setQuery(''); }} onValueChange={next => { if (next) onPick(next); }} autoHighlight>
    <Tip content={current ? `Switch branch from ${current}` : 'Switch branch'} delay="long"><ComboboxTrigger aria-label={`Branch: ${current ?? 'loading'}`} render={<Button variant="outline" size="sm" className="branch-trigger" />}>
      <GitBranch className="text-muted-foreground" />{current ? <span className="min-w-0 flex-1 truncate text-left">{current}</span> : <Skeleton className="h-3 w-24" />}{current && notes.get(current) && <span className="branch-note">{notes.get(current)}</span>}
    </ComboboxTrigger></Tip>
    <ComboboxContent align="start" className="w-72">
      <ComboboxInput showTrigger={false} placeholder="Find a branch…" aria-label="Find a branch" />
      <ComboboxEmpty>{searching ? 'Searching…' : 'No branches match'}</ComboboxEmpty>
      <ComboboxList>{(name: string) => <ComboboxItem key={name} value={name}><GitBranch className="text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{name}</span>{notes.get(name) && <span className="branch-note">{notes.get(name)}</span>}</ComboboxItem>}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}

// The repository as a folder tree, opened to the current file. Changed files carry their status and line counts.
function RepoFileTree({ paths, changes, current, search, open, onPick }: { paths: string[]; changes: ChangedFile[]; current: string | null; search: string; open: boolean; onPick: (path: string) => void }) {
  const latest = useRef(onPick); latest.current = onPick;
  // Selecting the current file programmatically also fires onSelectionChange; this skips that echo.
  const echo = useRef<string | null>(current), files = useMemo(() => new Set(paths), [paths]), changed = useMemo(() => new Map(changes.map(file => [file.path, file])), [changes]);
  const { model } = useFileTree({
    paths, flattenEmptyDirectories: true, initialExpansion: open ? 'open' : 'closed', initialExpandedPaths: current ? ancestors(current) : [], initialSelectedPaths: current ? [current] : [], fileTreeSearchMode: 'hide-non-matches',
    gitStatus: changes.map(file => ({ path: file.path, status: statuses[file.status] ?? 'modified' })),
    // Line counts already mark a changed file, so a modified file drops its letter to leave room for its name in deep folders.
    unsafeCSS: `[data-item-git-status] > [data-item-section="content"] { color: inherit; } [data-item-type="file"][data-item-git-status="modified"] > [data-item-section="git"] { display: none; } [data-item-git-status="deleted"] > [data-item-section="content"] { text-decoration: line-through; color: var(--trees-fg-muted-override); } [data-item-flattened-subitem]:hover { text-decoration: none; } [data-item-flattened-subitems] { min-width: 0; } [data-item-flattened-subitem]:not(:last-child) { flex: 0 0 auto; min-width: max-content; } [data-item-flattened-subitem]:last-child { flex: 1 1 auto; min-width: 0; } [data-file-tree-virtualized-scroll] { overscroll-behavior: contain; } [data-item-section="decoration"] { flex: 0 0 auto; font-size: 11px; font-variant-numeric: tabular-nums; padding-left: 6px; }`,
    onSelectionChange: selected => {
      const path = selected[selected.length - 1];
      if (!path) return;
      if (path === echo.current) { echo.current = null; return; }
      if (files.has(path)) latest.current(path);
    },
    renderRowDecoration: ({ item }) => {
      const file = item.kind === 'file' ? changed.get(item.path) : undefined;
      if (!file) return null;
      const parts = [{ text: `+${file.additions}`, color: colors.added }, ...(file.deletions ? [{ text: ` −${file.deletions}`, color: colors.removed }] : [])];
      return { text: parts.map(part => part.text).join(''), parts };
    }
  });
  useEffect(() => { model.setSearch(search || null); }, [search, model]);
  const revealed = useRef(false);
  useEffect(() => {
    if (!current) return;
    if (!model.getSelectedPaths().includes(current)) {
      echo.current = current;
      for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
      for (const folder of ancestors(current)) { const item = model.getItem(folder); if (item && 'expand' in item) item.expand(); }
      model.getItem(current)?.select();
    }
    // The first reveal centres the file; later ones scroll only as far as needed.
    const frame = requestAnimationFrame(() => { model.scrollToPath(current, { focus: false, offset: revealed.current ? 'nearest' : 'center' }); revealed.current = true; });
    return () => cancelAnimationFrame(frame);
  }, [current, model]);
  return <FileTree model={model} className="changed-file-tree" />;
}

// Where a branch's changes sit in the file: new lines, changed lines (added where lines were removed), and the line each removal sits
// above (one past the last line for a removal at the end). `blocks` are the first lines of each change. Read from the patch, so a file
// without one has no marks.
type ChangeMarks = { added: number[]; changed: number[]; removed: number[]; blocks: number[] };
function changeMarks(file: ChangedFile | undefined, lineCount: number): ChangeMarks {
  const marks: ChangeMarks = { added: [], changed: [], removed: [], blocks: [] };
  const lines = file?.lines ?? [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind === 'context') { i++; continue; }
    let end = i;
    while (end < lines.length && lines[end].kind !== 'context' && lines[end].hunk === lines[i].hunk) end++;
    const block = lines.slice(i, end), added = block.flatMap(line => line.kind === 'add' && line.newLine ? [line.newLine] : []);
    if (added.length) { (block.some(line => line.kind === 'remove') ? marks.changed : marks.added).push(...added); marks.blocks.push(added[0]); }
    else {
      // A removal sits above the next line of the new file, or below the last one.
      const next = lines.slice(end).find(line => line.hunk === lines[i].hunk && line.newLine)?.newLine ?? (lines.slice(0, i).reverse().find(line => line.newLine)?.newLine ?? 0) + 1;
      marks.removed.push(Math.max(1, next)); marks.blocks.push(Math.max(1, Math.min(next, lineCount)));
    }
    i = end;
  }
  return marks;
}
// Marks drawn inside the renderer's shadow root: a tinted row and a gutter bar per new or changed line, and a notch where lines were removed.
function marksCSS({ added, changed, removed }: ChangeMarks, lineCount: number) {
  const rows = (lines: number[]) => lines.map(line => `[data-line="${line}"]`).join(','), gutters = (lines: number[]) => lines.map(line => `[data-column-number="${line}"]`).join(',');
  const rules = ['[data-column-number] { position: relative; }'];
  for (const [lines, color] of [[added, 'var(--diffs-addition-base)'], [changed, 'var(--diffs-modified-base)']] as const) {
    if (!lines.length) continue;
    rules.push(`:is(${rows(lines)}) { background-color: color-mix(in lab, var(--diffs-bg) 90%, ${color}); }`);
    rules.push(`:is(${gutters(lines)}) { color: ${color}; background-color: color-mix(in lab, var(--diffs-bg) 90%, ${color}); }`);
    rules.push(`:is(${gutters(lines)})::before { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 3px; background-color: ${color}; }`);
  }
  // A removal after the last line sits on that line's lower edge instead.
  const notch = (edge: 'top' | 'bottom', lines: number[]) => lines.length ? [`:is(${gutters(lines)})::after { content: ''; position: absolute; z-index: 1; ${edge}: -4px; left: 0; border-block: 4px solid transparent; border-left: 6px solid var(--diffs-deletion-base); }`] : [];
  rules.push(...notch('top', removed.filter(line => line <= lineCount)), ...notch('bottom', removed.some(line => line > lineCount) ? [lineCount] : []));
  return rules.join('\n');
}

// One file at the branch, in full, with the branch's new and changed lines marked instead of shown as a diff.
// `j` and `k` step through the changes. `onShowDiff` opens the file's diff when it is part of this PR.
export function FileViewer({ snapshot, branch, path, display, offset, onBranch, onShowDiff }: { snapshot: Snapshot; branch: string | null; path: string | null; display: DisplaySettings; offset: number; onBranch: (name: string) => void; onShowDiff: (path: string) => void }) {
  const browse = useBrowse(snapshot, branch), tree = browse.tree.status === 'ready' ? browse.tree.value : null;
  const exists = useMemo(() => tree && path ? new Set(tree.paths).has(path) : false, [tree, path]);
  const change = path ? changeList(browse).find(file => file.path === path) : undefined;
  const content = useLoaded<string>(exists && browse.sha && path ? `file:${browse.repo}@${browse.sha}:${path}` : null, () => readFile({ data: { repo: browse.repo, sha: browse.sha!, path: path! } }));
  const inDiff = path && snapshot.files.some(file => file.path === path) ? path : null;
  const { name, directory } = splitPath(path ?? '');
  const text = content.status === 'ready' ? content.value : null, binary = text !== null && text.slice(0, 8000).includes('\0');
  const lineCount = useMemo(() => text === null ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0), [text]);
  const marks = useMemo(() => changeMarks(change, lineCount), [change, lineCount]);
  const instance = useRef<VirtualizedFile<undefined, undefined> | null>(null), view = useRef<HTMLDivElement>(null);
  const options = useMemo<FileOptions<undefined, undefined>>(() => ({
    theme: codeTheme, themeType: 'system', disableFileHeader: true, overflow: display.wrap ? 'wrap' : 'scroll', disableLineNumbers: !display.lineNumbers, unsafeCSS: marksCSS(marks, lineCount),
    onPostRender: (_node, rendered, phase) => { instance.current = phase !== 'unmount' && rendered instanceof VirtualizedFile ? rendered : null; }
  }), [display.wrap, display.lineNumbers, marks, lineCount]);
  const size = { font: display.fontSize, line: lineHeightFor(display.fontSize) }, metrics = useMemo(() => ({ ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight: size.line, diffHeaderHeight: 0, spacing: 0, paddingTop: 0, paddingBottom: 0 }), [size.line]);
  const file = useMemo(() => text !== null && path && !binary ? { name: path, contents: text, cacheKey: `${browse.sha}:${path}` } : null, [text, path, binary, browse.sha]);
  // Brings the next or previous change to a third of the way down the screen.
  function step(direction: 1 | -1) {
    const container = view.current?.querySelector('diffs-container'), rendered = instance.current;
    if (!container || !rendered || !marks.blocks.length) return;
    const top = container.getBoundingClientRect().top, anchor = offset + (window.innerHeight - offset) / 3;
    const tops = marks.blocks.map(line => top + (rendered.getLinePosition(line)?.top ?? 0));
    const target = direction === 1 ? tops.find(value => value > anchor + 2) : tops.filter(value => value < anchor - 2).pop();
    if (target !== undefined) scrollPageBy(target - anchor);
  }
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || (event.key !== 'j' && event.key !== 'k')) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      event.preventDefault(); step(event.key === 'j' ? 1 : -1);
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const retry = (state: { status: string; retry?: () => void }) => state.retry && <Button variant="outline" size="xs" onClick={state.retry}>Retry</Button>;
  const count = marks.blocks.length;
  return <div className="files-page">
    <div className="diff-toolbar files-toolbar">
      {path ? <>
        <span className="files-path"><FileCode2 size={14} /><Tip content={path} delay="long"><span className="files-path-text"><span className="directory">{directory}</span><span className="filename">{name}</span></span></Tip></span>
        {change && <FileCount file={change} />}
      </> : <span className="files-path"><GitBranch size={14} /><span className="filename">{browse.name ?? 'Files'}</span></span>}
      <span className="toolbar-actions">
        {file && change && <span className="files-changes">
          <Tip content={`Green marks new lines, blue marks changed lines and red marks where lines were removed${browse.inPull ? ' in this pull request' : `, against ${browse.against}`}.`} delay="long"><span className="toolbar-progress">{count} {count === 1 ? 'change' : 'changes'}</span></Tip>
          <Tip content="Previous change" hotkey="K" side="bottom"><Button variant="ghost" size="icon-sm" aria-label="Previous change" disabled={!count} onClick={() => step(-1)}><ChevronUp /></Button></Tip>
          <Tip content="Next change" hotkey="J" side="bottom"><Button variant="ghost" size="icon-sm" aria-label="Next change" disabled={!count} onClick={() => step(1)}><ChevronDown /></Button></Tip>
        </span>}
        {inDiff && <Button variant="ghost" size="sm" onClick={() => onShowDiff(inDiff)}>Show diff</Button>}
        {path && browse.sha && exists && <Tip content="Open on GitHub" side="bottom"><a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={`https://github.com/${browse.repo}/blob/${browse.sha}/${path.split('/').map(encodeURIComponent).join('/')}`} target="_blank" rel="noopener noreferrer">GitHub</a></Tip>}
      </span>
    </div>
    <div className="diff-body">
      {!path ? <div className="files-empty">
        <h2>{browse.name ? `Browse ${browse.name}` : 'Browse files'}</h2>
        <p>Pick a file in the sidebar to read it in full. {browse.inPull ? 'Files this pull request changes show their line counts, and their new and changed lines are marked.' : browse.changes ? `Files changed against ${browse.against} show their line counts, and their new and changed lines are marked.` : 'Switch branch to see another branch’s files and what it changes.'}</p>
      </div>
        : browse.tree.status === 'error' ? <div className="files-message is-error" role="alert">{browse.tree.message}{retry(browse.tree)}</div>
        : !browse.name && browse.branches.status === 'error' ? <div className="files-message is-error" role="alert">Couldn’t find the default branch. {browse.branches.message}{retry(browse.branches)}</div>
        : !tree || (exists && content.status === 'loading') ? <div className="file-viewer"><div className="files-loading" role="status" aria-label="Loading the file">{['w-2/5', 'w-3/5', 'w-1/2', 'w-4/5', 'w-1/3', 'w-2/3'].map((width, index) => <Skeleton key={index} className={`h-3 ${width}`} />)}</div></div>
        : !exists ? <div className="files-message">
          {change?.status === 'removed' ? <span>{browse.inPull ? 'This pull request deletes this file.' : `${browse.name} deletes this file.`}</span> : <span>There is no <code>{path}</code> on <code>{browse.name}</code>.</span>}
          {browse.against && browse.against !== browse.name && <Button variant="outline" size="xs" onClick={() => onBranch(browse.against)}>View on {browse.against}</Button>}
        </div>
        : content.status === 'error' ? <div className="files-message is-error" role="alert">Could not load this file. {content.message}{retry(content)}</div>
        : binary ? <div className="files-message">This is a binary file, so it isn’t shown.</div>
        : file && <article className="file-viewer">
          {change && change.availability !== 'complete' && <div className="diff-note">{change.availability === 'partial' ? 'GitHub sent only part of this file’s changes, so some are not marked.' : 'GitHub sent no changes for this file, so none are marked.'}</div>}
          <div className="diff-view" ref={view} style={{ '--diffs-font-size': `${size.font}px`, '--diffs-line-height': `${size.line}px` } as CSSProperties}>
            <ErrorBoundary key={`${browse.sha}:${path}`} fallback={<div className="missing">This file could not be displayed. Open it on GitHub instead.</div>}><File file={file} options={options} metrics={metrics} /></ErrorBoundary>
          </div>
        </article>}
    </div>
  </div>;
}
