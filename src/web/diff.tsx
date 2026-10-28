import { lazy, memo, Suspense, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { FileDiff, VirtualizerContext, WorkerPoolContextProvider } from '@pierre/diffs/react';
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';
import { DEFAULT_VIRTUAL_FILE_METRICS, parsePatchFiles, VirtualizedFileDiff, Virtualizer, type DiffLineAnnotation, type FileDiffOptions, type SelectedLineRange } from '@pierre/diffs';
import { ChevronRight, Code2, Ellipsis, Eye, FileCode2, History, MessageSquare, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Annotation, FileComments, type AnnotationData, type CommentData } from './comments';
import { pullLink } from './links';
import { hideWhitespace, lineHeightFor, type DisplaySettings } from './display';
import { codeTheme as theme, commentAnchor, DiffSourceContext, diffPositions, fileAnchor, pageVirtualizer, splitPath, useReview } from './pull-page';
import { ErrorBoundary, Tip } from './ui';
import { readFile } from '../pull.functions';
import type { ChangedFile, DraftComment, CommentThread, RangePull } from '../types';

export function FileCount({ file }: { file: ChangedFile }) {
  return <span className="file-count"><span className="added">+{file.additions}</span>{file.deletions > 0 && <span className="removed">−{file.deletions}</span>}</span>;
}
function FileStatus({ file }: { file: ChangedFile }) {
  if (file.status === 'added') return <span className="file-status added-status">New</span>;
  if (file.status === 'removed') return <span className="file-status removed-status">Deleted</span>;
  if (file.status === 'renamed' && file.previousPath) return <Tip content={`Renamed from ${file.previousPath}`}><span className="file-status">Renamed</span></Tip>;
  return null;
}

// Find-in-diff marks matches with the CSS Custom Highlight API; the styles must live inside the renderer's shadow root.
const icon = (paths: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>`)}")`;
// Unchanged-line separators restyled as a tinted bar of text buttons: "↧ 20 lines · ↕ All N lines · ↥ 20 lines".
// The renderer's own buttons do the expanding; labelSeparators below gives them their text.
const separatorCSS = `
[data-separator=line-info] { margin-block: 0 !important; background-color: var(--sep-bg) !important; }
[data-gutter] [data-separator=line-info] [data-separator-wrapper] { display: flex !important; align-items: center; gap: 22px; width: 100cqi !important; margin: 0 !important; padding-inline: 14px !important; border-radius: 0 !important; background-color: var(--sep-bg) !important; grid-template-columns: none !important; grid-template-rows: none !important; }
[data-separator=line-info] [data-separator-content] { display: none !important; }
[data-separator=line-info] [data-expand-button] { display: inline-flex !important; align-items: center; gap: 6px; min-width: 0 !important; height: 100%; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: none !important; color: var(--sep-fg) !important; font-size: 13px; white-space: nowrap; }
[data-separator=line-info] [data-expand-button]:hover { color: var(--sep-hover) !important; }
[data-separator=line-info] [data-expand-button] [data-icon] { display: none; }
[data-separator=line-info] [data-expand-button]::before { content: ''; width: 14px; height: 14px; background-color: currentColor; mask: ${icon("<path d='M12 3v12'/><path d='m6 9 6 6 6-6'/><path d='M5 21h14'/>")} center / contain no-repeat; }
[data-separator=line-info] [data-expand-up] { order: 1; }
[data-separator=line-info] :is([data-expand-both], [data-expand-all-button]) { order: 2; }
[data-separator=line-info] :is([data-expand-both], [data-expand-all-button])::before { mask-image: ${icon("<path d='m7 15 5 5 5-5'/><path d='m7 9 5-5 5 5'/>")}; }
[data-separator=line-info] [data-expand-down] { order: 3; }
[data-separator=line-info] [data-expand-down]::before { mask-image: ${icon("<path d='M12 21V9'/><path d='m18 15-6-6-6 6'/><path d='M5 3h14'/>")}; }
:host { --sep-bg: oklch(0.96 0.02 250); --sep-fg: oklch(0.55 0.14 250); --sep-hover: oklch(0.42 0.16 255); }
@media (prefers-color-scheme: dark) { :host { --sep-bg: oklch(0.28 0.04 255); --sep-fg: oklch(0.78 0.1 250); --sep-hover: oklch(0.88 0.08 250); } }`;
const expansionLineCount = 20;
// Rewrites the renderer's separator labels ("16 unmodified lines", icon-only buttons) to match the bar above.
function labelSeparators(root: ShadowRoot) {
  for (const wrapper of Array.from(root.querySelectorAll('[data-separator=line-info] [data-separator-wrapper]'))) {
    const count = Number(wrapper.querySelector('[data-unmodified-lines]')?.textContent?.match(/\d[\d,]*/)?.[0].replace(/,/g, '') ?? NaN);
    for (const button of Array.from(wrapper.querySelectorAll<HTMLElement>('[data-expand-button]'))) {
      const chunk = button.matches('[data-expand-up], [data-expand-down]') && wrapper.querySelector('[data-expand-all-button]');
      const text = chunk ? `${expansionLineCount} lines` : Number.isFinite(count) ? `All ${count.toLocaleString()} lines` : 'Show all';
      if (button.dataset.label === text) continue;
      button.dataset.label = text;
      Array.from(button.childNodes).filter(node => node.nodeType === Node.TEXT_NODE || (node as Element).matches?.('[data-label]')).forEach(node => node.remove());
      const label = document.createElement('span'); label.setAttribute('data-label', ''); label.textContent = text; button.append(label);
    }
  }
}
// Reserve room for the comment button inside the gutter so it cannot intercept code-text drags.
const unsafeCSS = separatorCSS + `[data-column-number], [data-gutter-buffer] { padding-left: max(2ch, 1lh); }
[data-gutter-utility-slot] { left: 0; right: auto; }
[data-utility-button] { margin-right: 0; }
[data-disable-line-numbers] [data-column-number], [data-disable-line-numbers] [data-gutter-buffer] { min-width: 1lh; }
::highlight(pr-find) { background-color: oklch(0.92 0.13 95 / 0.75); color: inherit; } ::highlight(pr-find-current) { background-color: oklch(0.8 0.16 65); color: oklch(0.2 0 0); }
@media (prefers-color-scheme: dark) { ::highlight(pr-find) { background-color: oklch(0.55 0.11 95 / 0.55); } ::highlight(pr-find-current) { background-color: oklch(0.78 0.15 70); color: oklch(0.15 0 0); } }`;
// Syntax highlighting runs in workers, and only lines near the viewport are in the DOM, so large PRs stay responsive.
const poolOptions = { workerFactory: () => new DiffsWorker(), poolSize: Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1)) };
// Where the diffs come from, so unchanged lines can be fetched when a hunk is expanded.
export type DiffSource = { repo: string; base: string; head: string };
export function DiffProvider({ source, children }: { source: DiffSource; children: ReactNode }) {
  const [virtualizer] = useState(() => { const instance = new Virtualizer(); instance.setup(document); return instance; });
  pageVirtualizer.current = virtualizer;
  // Cleaning up forgets every connected diff for good, so only do it on a real unmount. React re-runs effects without
  // unmounting (hot reload), and that left the page with empty diffs; a re-run cancels the pending cleanup instead.
  const pendingCleanup = useRef(0);
  useEffect(() => {
    clearTimeout(pendingCleanup.current);
    return () => { pendingCleanup.current = window.setTimeout(() => { virtualizer.cleanUp(); if (pageVirtualizer.current === virtualizer) pageVirtualizer.current = null; }); };
  }, [virtualizer]);
  const stableSource = useMemo(() => source, [source.repo, source.base, source.head]);
  return <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={{ theme, lineDiffType: 'word' }}>
    <VirtualizerContext.Provider value={virtualizer}><DiffSourceContext.Provider value={stableSource}>{children}</DiffSourceContext.Provider></VirtualizerContext.Provider>
  </WorkerPoolContextProvider>;
}
const fileAt = (source: DiffSource, sha: string, path: string) => readFile({ data: { repo: source.repo, sha, path } });
const MarkdownPreview = lazy(() => import('./markdown-preview'));

// Memoized with path-taking callbacks, so a change elsewhere on the page doesn't re-render every diff.
// On a range, `pulls` are the PRs in it that changed the file; each links to that PR's diff at this file.
// `onOpenFile` shows the whole file before or after the change on Files.
export const DiffCard = memo(function DiffCard({ file, pulls, open, viewed, onToggle, onViewed, display, selectedLines, onSelectionChange, preview, onPreview, onOpenFile }: { file: ChangedFile; pulls?: RangePull[]; open: boolean; viewed: boolean; onToggle: (path: string) => void; onViewed: (path: string, viewed: boolean) => void; display: DisplaySettings; selectedLines: SelectedLineRange | null; onSelectionChange: (path: string, range: SelectedLineRange | null) => void; preview: boolean; onPreview: (path: string, preview: boolean) => void; onOpenFile: (file: ChangedFile, version: 'old' | 'new') => void }) {
  const review = useReview(), source = useContext(DiffSourceContext), { name, directory } = splitPath(file.path);
  // Only open threads still in the diff, on its lines or on the whole file, show on the file, so only those count.
  const commentCount = (review?.threads.filter(thread => thread.path === file.path && !thread.outdated && !thread.resolved).length ?? 0) + (review?.drafts.filter(draft => draft.path === file.path).length ?? 0);
  const commentOnFile = review && (() => { review.setComposer({ path: file.path, file: true }); if (!open) onToggle(file.path); });
  return <article className={`diff-card ${open ? 'expanded' : ''} ${viewed ? 'is-read' : ''}`} id={fileAnchor(file.path)}>
    <div className="file-heading">
      <button type="button" className="file-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${file.path}`} aria-expanded={open} onClick={() => onToggle(file.path)}><ChevronRight size={13} className="chevron" /><span className="filename">{name}</span><span className="directory">{directory}</span><FileStatus file={file} /></button>
      {source && pulls && pulls.length > 0 && <span className="file-pulls">{pulls.map(pull => <Tip key={pull.number} content={`Open this file in #${pull.number}: ${pull.title}`} delay="long"><Link {...pullLink(source.repo, pull.number, 'diff')} hash={fileAnchor(file.path)} className="file-pull">#{pull.number}</Link></Tip>)}</span>}
      {commentCount > 0 && <Tip content={`${commentCount} comment ${commentCount === 1 ? 'thread' : 'threads'}`}><span className="comment-count"><MessageSquare size={12} />{commentCount}</span></Tip>}
      {/\.(md|markdown|mdown|mkd)$/i.test(file.path) && <Tip content={preview ? 'Show diff' : 'Preview Markdown'}><Button variant="ghost" size="icon-sm" aria-label={preview ? 'Show diff' : 'Preview Markdown'} aria-pressed={preview} onClick={() => { onPreview(file.path, !preview); if (!open) onToggle(file.path); }}>{preview ? <Code2 /> : <Eye />}</Button></Tip>}
      <FileCount file={file} />
      <label className="file-reviewed"><Checkbox aria-label={`Mark ${file.path} as reviewed`} checked={viewed} onCheckedChange={checked => onViewed(file.path, Boolean(checked))} />Reviewed</label>
      <FileMenu file={file} onComment={commentOnFile} onOpenFile={onOpenFile} />
    </div>
    {open && <div className="diff-card-body">
      <FileComments path={file.path} />
      <div hidden={preview}><ErrorBoundary key={JSON.stringify(display)} fallback={<div className="missing">The diff renderer could not display this patch. Open the PR on GitHub to inspect this file.</div>}><Diff file={file} display={display} selectedLines={selectedLines} onSelectionChange={onSelectionChange} /></ErrorBoundary></div>
      {preview && <Suspense fallback={<div className="markdown-preview-status" role="status">Loading preview…</div>}><MarkdownPreview file={file} /></Suspense>}
      {!preview && file.availability !== 'complete' && <div className="diff-caption">{file.availability === 'partial' ? 'Partial patch · GitHub omitted part of this file’s diff' : 'No patch available for this file'}</div>}
    </div>}
  </article>;
});

function FileMenu({ file, onComment, onOpenFile }: { file: ChangedFile; onComment: (() => void) | null; onOpenFile: (file: ChangedFile, version: 'old' | 'new') => void }) {
  return <DropdownMenu>
    <Tip content="File actions"><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="file-menu" aria-label={`Actions for ${file.path}`} />}><Ellipsis /></DropdownMenuTrigger></Tip>
    <DropdownMenuContent align="end" className="w-auto">
      {onComment && <DropdownMenuItem onClick={onComment}><MessageSquarePlus />Add file comment</DropdownMenuItem>}
      <DropdownMenuItem disabled={file.status === 'added'} onClick={() => onOpenFile(file, 'old')}><History />View old file</DropdownMenuItem>
      <DropdownMenuItem disabled={file.status === 'removed'} onClick={() => onOpenFile(file, 'new')}><FileCode2 />View new file</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

// The renderer compares annotations by the identity of their metadata, so each thread or draft keeps one metadata object.
const metadataFor = new WeakMap<CommentThread | DraftComment, CommentData>();
function metadata(item: CommentThread | DraftComment, kind: 'thread' | 'draft'): CommentData {
  let value = metadataFor.get(item);
  if (!value) { value = kind === 'thread' ? { kind, thread: item as CommentThread } : { kind, draft: item as DraftComment }; metadataFor.set(item, value); }
  return value;
}

function Diff({ file, display, selectedLines, onSelectionChange }: { file: ChangedFile; display: DisplaySettings; selectedLines: SelectedLineRange | null; onSelectionChange: (path: string, range: SelectedLineRange | null) => void }) {
  const review = useReview();
  const { parsed, onlyWhitespace } = useMemo(() => {
    if (!file.patch) return { parsed: null, onlyWhitespace: false };
    const body = display.whitespace === 'hide' ? hideWhitespace(file.patch) : { patch: file.patch, onlyWhitespace: false };
    const oldPath = `a/${file.previousPath ?? file.path}`, newPath = `b/${file.path}`;
    const patch = `diff --git ${JSON.stringify(oldPath)} ${JSON.stringify(newPath)}\n${file.status === 'added' ? 'new file mode 100644\n' : file.status === 'removed' ? 'deleted file mode 100644\n' : ''}--- ${file.status === 'added' ? '/dev/null' : JSON.stringify(oldPath)}\n+++ ${file.status === 'removed' ? '/dev/null' : JSON.stringify(newPath)}\n${body.patch}\n`;
    return { parsed: parsePatchFiles(patch)[0]?.files[0] ?? null, onlyWhitespace: body.onlyWhitespace };
  }, [file, display.whitespace]);
  const source = useContext(DiffSourceContext);
  const threads = review?.threads, drafts = review?.drafts, setComposer = review?.setComposer;
  const composer = review?.composer?.path === file.path && !('file' in review.composer) ? review.composer : null;
  const mode = review?.commentMode ?? 'inline', focus = review?.focus ?? null;
  const groupCache = useRef(new Map<string, AnnotationData & { kind: 'group' }>());
  const annotations = useMemo(() => {
    const comments = [
      // Indicator mode keeps resolved threads as faded avatars; inline mode only reveals them when jumped to.
      ...(threads ?? []).filter(thread => thread.path === file.path && thread.line !== null && (mode === 'indicators' || !thread.resolved || `thread-${thread.id}` === focus)).map(thread => ({ side: thread.side, lineNumber: thread.line!, metadata: metadata(thread, 'thread') })),
      ...(drafts ?? []).filter(draft => draft.path === file.path && draft.line !== null).map(draft => ({ side: draft.side, lineNumber: draft.line!, metadata: metadata(draft, 'draft') }))
    ].filter(item => mode !== 'hidden' || commentAnchor(item.metadata) === focus);
    let list: DiffLineAnnotation<AnnotationData>[] = comments as DiffLineAnnotation<AnnotationData>[];
    if (mode === 'indicators') {
      const byLine = new Map<string, typeof comments>();
      for (const item of comments) { const key = `${item.side}:${item.lineNumber}`; byLine.set(key, [...(byLine.get(key) ?? []), item]); }
      list = [...byLine].map(([key, items]) => {
        // Reuse the group object while its comments are unchanged, so the renderer keeps the row.
        const previous = groupCache.current.get(key), next = items.map(item => item.metadata);
        const group = previous && previous.items.length === next.length && previous.items.every((item, i) => item === next[i]) ? previous : { kind: 'group' as const, items: next };
        groupCache.current.set(key, group);
        return { side: items[0].side, lineNumber: items[0].lineNumber, metadata: group } as DiffLineAnnotation<AnnotationData>;
      });
    }
    if (composer) list.push({ side: composer.side, lineNumber: composer.end, metadata: { kind: 'composer', target: composer } });
    return list;
  }, [threads, drafts, composer, file.path, mode, focus]);
  // A new options object, or a new function inside it, makes the renderer redraw the whole file.
  const options = useMemo<FileDiffOptions<AnnotationData, undefined>>(() => ({
    theme, themeType: 'system', unsafeCSS, diffStyle: display.layout, overflow: display.wrap ? 'wrap' : 'scroll', disableLineNumbers: !display.lineNumbers, lineDiffType: display.wordDiff ? 'word' : 'none', disableFileHeader: true, enableLineSelection: true,
    onPostRender: (node, instance, phase) => {
      if (phase === 'unmount') diffPositions.delete(node);
      else if (instance instanceof VirtualizedFileDiff) diffPositions.set(node, instance);
    },
    onLineSelectionEnd: (range: SelectedLineRange | null) => onSelectionChange(file.path, range),
    enableGutterUtility: Boolean(setComposer), hunkSeparators: 'line-info', expansionLineCount,
    // Expanding a hunk fetches both versions of the file once; until then only the patch is shown.
    loadDiffFiles: source ? async () => {
      const oldPath = file.previousPath ?? file.path, [oldText, newText] = await Promise.all([fileAt(source, source.base, oldPath), fileAt(source, source.head, file.path)]);
      return { oldFile: { name: oldPath, contents: oldText, cacheKey: `${source.base}:${oldPath}` }, newFile: { name: file.path, contents: newText, cacheKey: `${source.head}:${file.path}` } };
    } : undefined,
    onGutterUtilityClick: (range: SelectedLineRange) => {
      if (!setComposer) return;
      // GitHub needs both ends of a multi-line comment on the same side; otherwise comment on the last line.
      const side = range.endSide ?? range.side ?? 'additions', sameSide = (range.side ?? side) === side;
      setComposer({ path: file.path, side, start: sameSide ? Math.min(range.start, range.end) : range.end, end: sameSide ? Math.max(range.start, range.end) : range.end });
    }
  }), [display, setComposer, file.path, source, onSelectionChange]);
  const size = { font: display.fontSize, line: lineHeightFor(display.fontSize) }, metrics = useMemo(() => ({ ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight: size.line, diffHeaderHeight: 0, spacing: 0, paddingTop: 0, paddingBottom: 0 }), [size.line]);
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The renderer redraws separators as rows scroll in and as hunks expand; relabel them before they paint.
    const root = view.current?.querySelector('diffs-container')?.shadowRoot;
    if (!root) return;
    const observer = new MutationObserver(() => labelSeparators(root));
    observer.observe(root, { childList: true, subtree: true }); labelSeparators(root);
    return () => observer.disconnect();
  }, [parsed]);
  if (!parsed) return <div className="missing">No text patch was supplied for this file. Open the PR on GitHub to inspect it.</div>;
  return <div className="diff-view" ref={view} style={{ '--diffs-font-size': `${size.font}px`, '--diffs-line-height': `${size.line}px` } as CSSProperties}>
    {onlyWhitespace && <div className="diff-note">Only whitespace changed in this file.</div>}
    <FileDiff<AnnotationData> fileDiff={parsed} lineAnnotations={annotations} renderAnnotation={renderAnnotation} options={options} metrics={metrics} selectedLines={selectedLines} />
  </div>;
}
const renderAnnotation = (annotation: DiffLineAnnotation<AnnotationData>) => annotation.metadata ? <Annotation data={annotation.metadata} /> : null;
