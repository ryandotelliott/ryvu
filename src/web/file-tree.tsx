import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ChevronRight, FileCode2, List, ListTree, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { FileTree, useFileTree } from '@pierre/trees/react';
import type { GitStatus } from '@pierre/trees';
import { FileCount } from './diff';
import { matchesPattern, type HiddenFiles } from './file-filters';
import { contains } from './fuzzy';
import { splitPath } from './pull-page';
import { focusOnKeyboardOpen, Segmented, Switch, Tip } from './ui';
import type { ChangedFile } from '../types';

const statuses: Record<string, GitStatus> = { added: 'added', removed: 'deleted', renamed: 'renamed' };
const colors = { added: 'var(--added)', removed: 'var(--removed)', read: 'var(--text-4)', tag: 'var(--text-3)' };

// The changed files as a folder tree. `current` follows the file being read; picking a file reports it through `onPick`.
// `tags`, on a range, name the PRs that changed each file in place of its line counts.
export function ChangedFileTree({ files, viewed, current, search, tags, onPick }: { files: ChangedFile[]; viewed: string[]; current: string | null; search: string; tags?: Map<string, string>; onPick: (path: string) => void }) {
  const latest = useRef({ viewed, tags, onPick }); latest.current = { viewed, tags, onPick };
  // Selecting the current file programmatically also fires onSelectionChange; this skips that echo.
  const echo = useRef<string | null>(null), shown = useRef(false);
  const { model } = useFileTree({
    paths: files.map(file => file.path), flattenEmptyDirectories: true, initialExpansion: 'open', fileTreeSearchMode: 'hide-non-matches',
    // Only additions, deletions and renames get a status badge; nearly every file is modified.
    gitStatus: files.flatMap(file => statuses[file.status] ? [{ path: file.path, status: statuses[file.status] }] : []),
    unsafeCSS: `[data-item-type="file"][aria-selected="true"] { background: linear-gradient(to right, var(--file-progress-fill) calc(var(--file-progress, 0) * 100%), var(--file-progress-track) 0); --truncate-marker-background-color: var(--file-progress-track); --truncate-marker-background-overlay-color: transparent; } [data-item-git-status] > [data-item-section="content"] { color: inherit; } [data-item-flattened-subitem]:hover { text-decoration: none; } [data-item-flattened-subitems] { min-width: 0; } [data-item-flattened-subitem]:not(:last-child) { flex: 0 0 auto; min-width: max-content; } [data-item-flattened-subitem]:last-child { flex: 1 1 auto; min-width: 0; } [data-file-tree-virtualized-scroll] { overscroll-behavior: contain; } [data-item-section="decoration"] { flex: 0 0 auto; font-size: 11px; font-variant-numeric: tabular-nums; padding-left: 6px; } [data-item-type="folder"] [data-item-section="git"] { display: none; }`,
    onSelectionChange: paths => {
      const path = paths[paths.length - 1];
      if (!path) return;
      if (path === echo.current) { echo.current = null; return; }
      if (files.some(file => file.path === path)) latest.current.onPick(path);
    },
    renderRowDecoration: ({ item }) => {
      const file = item.kind === 'file' ? files.find(candidate => candidate.path === item.path) : null;
      if (!file) return null;
      const read = latest.current.viewed.includes(file.path), tag = latest.current.tags?.get(file.path);
      if (latest.current.tags) return tag ? { text: tag, parts: [{ text: tag, color: read ? colors.read : colors.tag }] } : null;
      const parts = [{ text: `+${file.additions}`, color: read ? colors.read : colors.added }, ...(file.deletions ? [{ text: `\u00a0−${file.deletions}`, color: read ? colors.read : colors.removed }] : [])];
      return { text: parts.map(part => part.text).join(''), parts };
    }
  });
  // Decorations read `viewed` when rows render, so re-render rows when it changes.
  useEffect(() => { model.setComposition(model.getComposition()); }, [viewed, model]);
  useEffect(() => { model.setSearch(search || null); }, [search, model]);
  useEffect(() => {
    if (!current || model.getSelectedPaths().includes(current)) return;
    echo.current = current;
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
    model.getItem(current)?.select();
    // The tree opens scrolled to the top; after that, keep the current file in view.
    if (shown.current) model.scrollToPath(current, { focus: false, offset: 'nearest' });
    shown.current = true;
  }, [current, model]);
  return <FileTree model={model} className="changed-file-tree" />;
}

// The changed files in the order the diff shows them.
export function ChangedFileList({ files, viewed, current, search, tags, onPick }: { files: ChangedFile[]; viewed: string[]; current: string | null; search: string; tags?: Map<string, string>; onPick: (path: string) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' }); }, [current, search]);
  return <div className="changed-file-list" ref={list}>{files.filter(file => contains(search, file.path)).map(file => {
    const { name, directory } = splitPath(file.path);
    return <Tip key={file.path} content={file.path} delay="long" side="right"><button type="button" className={`list-file ${file.path === current ? 'is-current' : ''} ${viewed.includes(file.path) ? 'is-read' : ''}`} onClick={() => onPick(file.path)}>
      <FileCode2 size={13} /><span className="filename">{name}</span><span className="directory">{directory}</span>{tags ? <span className="file-tags">{tags.get(file.path)}</span> : <FileCount file={file} />}
    </button></Tip>;
  })}</div>;
}

export type FileOrder = 'tree' | 'diff';
// How the files sidebar lists files, and which files it hides.
export function FileDisplayMenu({ order, onOrder, hidden, files, trigger }: { order: FileOrder; onOrder: (order: FileOrder) => void; hidden: HiddenFiles; files: ChangedFile[]; trigger?: ReactElement }) {
  const [draft, setDraft] = useState(''), [expanded, setExpanded] = useState(true), value = draft.trim();
  const matches = (pattern: string) => files.filter(file => matchesPattern(pattern, file.path)).length;
  const add = () => { if (value && !hidden.patterns.includes(value)) hidden.setPatterns([...hidden.patterns, value]); setDraft(''); };
  return <Popover>
    <Tip content="File display settings"><PopoverTrigger render={trigger ?? <Button variant="ghost" size="icon-sm" aria-label="File list display" />}><SlidersHorizontal /></PopoverTrigger></Tip>
    <PopoverContent positionMethod="fixed" side="bottom" align="end" sideOffset={6} className="w-[300px] gap-0 p-0" initialFocus={focusOnKeyboardOpen}>
      <div className="file-menu-section">
        <PopoverTitle className="file-menu-title">Show files</PopoverTitle>
        <Segmented label="Show files" value={order} onChange={onOrder} options={[{ value: 'diff', label: <><List size={13} />Diff order</> }, { value: 'tree', label: <><ListTree size={13} />Folders</> }]} />
      </div>
      <Collapsible open={hidden.enabled && expanded} onOpenChange={setExpanded} className="file-menu-section">
        <div className="file-menu-row">
          <CollapsibleTrigger className="file-menu-toggle" disabled={!hidden.enabled}><ChevronRight size={13} className="chevron" />Hide files{hidden.patterns.length > 0 && <span className="file-menu-count">{hidden.patterns.length}</span>}</CollapsibleTrigger>
          <Switch label="Hide files matching patterns" checked={hidden.enabled} onChange={enabled => { hidden.setEnabled(enabled); if (enabled) setExpanded(true); }} />
        </div>
        <CollapsibleContent className="file-menu-body">
          <form className="flex gap-1.5" onSubmit={event => { event.preventDefault(); add(); }}>
            <Input value={draft} onChange={event => setDraft(event.target.value)} placeholder="*.lock, docs/**" aria-label="Pattern to hide" spellCheck={false} className="h-7 text-xs" />
            <Button type="submit" size="sm" variant="outline" disabled={!value}>Hide</Button>
          </form>
          {value && <p className="file-menu-hint">Matches {matches(value)} of {files.length} files</p>}
          {hidden.patterns.length > 0 ? <ul className="file-menu-patterns">{hidden.patterns.map(pattern => <li key={pattern}>
            <span className="file-menu-pattern">{pattern}</span><span className="file-menu-count">{matches(pattern)} {matches(pattern) === 1 ? 'file' : 'files'}</span>
            <Tip content="Stop hiding" delay="instant"><Button variant="ghost" size="icon-xs" aria-label={`Stop hiding ${pattern}`} onClick={() => hidden.setPatterns(hidden.patterns.filter(item => item !== pattern))}><X /></Button></Tip>
          </li>)}</ul> : <p className="file-menu-hint">Use <b>*</b> within a folder and <b>**</b> across folders. A pattern without a slash matches file names anywhere. Saved for this repository.</p>}
        </CollapsibleContent>
      </Collapsible>
    </PopoverContent>
  </Popover>;
}
