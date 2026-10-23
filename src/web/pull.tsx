import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowLeft, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleX, Clock, ExternalLink, Eye, EyeOff, FileCode2, GitBranch, ListChecks, ListTree, LoaderCircle, MessageSquare, RotateCw, Search, SlidersHorizontal, Users, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { addDraft, deleteDraft, replyToThread, submitReview as postReview, updateDraft } from '../pull.functions';
import { agoLong, progressKey, readStored, useNow, writeStored } from './browser-state';
import { Activity, CommentsMenu, ReviewMenu, Toast, type ComposerTarget, type ReviewApi } from './comments';
import { DiffCard, DiffProvider, FileCount } from './diff';
import { ChangedFileList, ChangedFileTree, FileDisplayMenu } from './file-tree';
import { FindBar, findMatches, scrollToMatch, useFindHighlights } from './find';
import { clampFontSize, fontSizes, useDisplay, type DisplaySettings } from './display';
import { contains } from './fuzzy';
import { matchesPattern, useHiddenFiles } from './file-filters';
import { homeLink, pullLink, type PullViewName } from './links';
import { Avatar, CheckRow, focusOnKeyboardOpen, Kbd, PullIcon, RadioRows, RepoSwatch, ResizeHandle, Tip } from './ui';
import { inline, Markdown } from './markdown';
import { fileAnchor, ReviewContext, scrollPageBy, splitPath } from './pull-page';
import type { ChangedFile, Chapter, PullDetail, Reference, ReviewEvent, Snapshot } from '../types';

// Heights of the sticky top bar and the diff toolbar, so scrolled-to content lands below them.
const topbar = 48, toolbar = 44, initiallyOpen = 12;
type DiffView = Exclude<PullViewName, 'overview'>;
const views: [PullViewName, string][] = [['overview', 'Overview'], ['guide', 'Guide'], ['diff', 'Diff']];
const treeKey = 'pr-guide:file-tree', orderKey = 'pr-guide:file-order', treeWidthKey = 'pr-guide:file-tree-width', findCollapsedKey = 'pr-guide:find-collapsed';
const treeWidths = { min: 220, initial: 300, max: 520 };
// Jumps instantly, then re-aligns while the diff virtualizer swaps estimated heights for measured ones above the target.
function scrollToElement(target: string | (() => Element | null), offset: number, center = false) {
  let frames = 0, settled = 0;
  const align = () => {
    const element = typeof target === 'string' ? document.getElementById(target) : target();
    if (!element) { if (++frames < 30) requestAnimationFrame(align); return; }
    const box = element.getBoundingClientRect(), delta = Math.round(center ? box.top + box.height / 2 - (window.innerHeight + offset) / 2 : box.top - offset);
    if (Math.abs(delta) > 1) { scrollPageBy(delta); settled = 0; } else settled++;
    if (settled < 3 && ++frames < 30) requestAnimationFrame(align);
  };
  align();
}

// The diff only draws lines near the viewport, so step through the file until the comment's row exists, then center it.
function seekComment(anchor: string, fileId: string, offset: number) {
  const find = () => Array.from(document.querySelectorAll(`[data-comment-anchor~="${anchor}"]`)).find(element => element.getClientRects().length > 0) ?? null;
  let frames = 0, started = false;
  const step = () => {
    if (find()) { scrollToElement(find, offset, true); return; }
    if (++frames > 160) return;
    const card = document.getElementById(fileId);
    // Move every other frame so the virtualizer can draw the rows it scrolled to.
    if (card && frames % 2 === 0) {
      const box = card.getBoundingClientRect();
      if (!started) { scrollPageBy(box.top - offset); started = true; }
      else if (box.bottom > window.innerHeight) scrollPageBy(window.innerHeight * 0.6);
      else return;
    }
    requestAnimationFrame(step);
  };
  step();
}

export function PullView({ detail, onDetail, view, status, analyzing, onAnalyze, color }: { detail: PullDetail; onDetail: (update: (detail: PullDetail) => PullDetail) => void; view: PullViewName; status: ReactNode; analyzing: boolean; onAnalyze: (fresh: boolean) => void; color: string }) {
  const { snapshot, guide: review, conversation, drafts } = detail, guide = review?.guide ?? null;
  const repo = `${snapshot.identity.owner}/${snapshot.identity.repo}`, number = snapshot.identity.number, pullKey = `${repo.toLowerCase()}#${number}`;
  const [display, setDisplay, resetDisplay] = useDisplay(), navigate = useNavigate();
  const viewedKey = `pr-guide:viewed:${pullKey}@${snapshot.headSHA}`;
  // Files matching a hidden pattern stay out of the Diff page's list, diffs and totals.
  const hidden = useHiddenFiles(repo), patterns = hidden.enabled ? hidden.patterns : [];
  const shown = useMemo(() => snapshot.files.filter(file => !patterns.some(pattern => matchesPattern(pattern, file.path))), [snapshot.files, patterns.join('\n')]);
  // The guide's sections without hidden files; a section whose files are all hidden is left out.
  const chapters = useMemo(() => { const visible = new Set(shown.map(file => file.path)); return (guide?.chapters ?? []).map(chapter => ({ ...chapter, files: chapter.files.filter(path => visible.has(path)) })).filter(chapter => chapter.files.length); }, [guide, shown]);
  const hiddenNow = snapshot.files.filter(file => !shown.includes(file)).map(file => file.path);
  const staleFilters = Boolean(review) && (review!.ignored ?? []).length + hiddenNow.length > 0 && !((review!.ignored ?? []).length === hiddenNow.length && hiddenNow.every(path => review!.ignored!.includes(path)));
  const filteredCount = useMemo(() => snapshot.files.filter(file => hidden.patterns.some(pattern => matchesPattern(pattern, file.path))).length, [snapshot.files, hidden.patterns]);
  const [viewed, setViewed] = useState<string[]>(() => { const stored = readStored<unknown>(viewedKey, []); return Array.isArray(stored) ? stored.filter(path => snapshot.files.some(file => file.path === path)) : []; });
  const [open, setOpen] = useState<Record<DiffView, string[]>>(() => {
    const unread = (paths: string[]) => paths.filter(path => !viewed.includes(path));
    const firstChapter = chapters.find(chapter => unread(chapter.files).length);
    return { diff: unread(shown.map(file => file.path)).slice(0, initiallyOpen), guide: firstChapter ? unread(firstChapter.files).slice(0, 1) : [] };
  });
  const [filter, setFilter] = useState(''), [tree, setTree] = useState(() => readStored<unknown>(treeKey, false) === true), [current, setCurrent] = useState(0);
  const [previewed, setPreviewed] = useState<string[]>([]);
  const setFilePreview = useCallback((path: string, preview: boolean) => setPreviewed(previous => preview ? [...new Set([...previous, path])] : previous.filter(value => value !== path)), []);
  const [selected, setSelected] = useState<Reference | null>(null), [composer, setComposer] = useState<ComposerTarget | null>(null), [toast, setToast] = useState('');
  // A jump focuses one comment. Focus belongs to the comment mode it was set in, so switching modes never opens a popover on its own.
  const [focused, setFocused] = useState<{ anchor: string; mode: string } | null>(null), diffBody = useRef<HTMLDivElement>(null);
  const focus = focused?.mode === display.comments ? focused.anchor : null;
  const setFocus = useCallback((anchor: string | null) => setFocused(anchor ? { anchor, mode: display.comments } : null), [display.comments]);
  const filterInput = useRef<HTMLInputElement>(null), limitationsRef = useRef<HTMLDetailsElement>(null);
  const done = useMemo(() => chapters.filter(chapter => chapter.files.every(path => viewed.includes(path))).map(chapter => chapter.id), [chapters, viewed]);
  useEffect(() => { writeStored(viewedKey, viewed); }, [viewed, viewedKey]);
  useEffect(() => { if (review) writeStored(progressKey(review.key), done); }, [done, review?.key]);
  const [treeWidth, setTreeWidth] = useState(() => { const stored = readStored<unknown>(treeWidthKey, treeWidths.initial); return typeof stored === 'number' ? Math.min(treeWidths.max, Math.max(treeWidths.min, stored)) : treeWidths.initial; });
  useEffect(() => { writeStored(treeWidthKey, treeWidth); }, [treeWidth]);
  const [order, setOrder] = useState<'tree' | 'diff'>(() => readStored<unknown>(orderKey, 'diff') === 'tree' ? 'tree' : 'diff');
  useEffect(() => { writeStored(treeKey, tree); }, [tree]);
  useEffect(() => { writeStored(orderKey, order); }, [order]);
  // Where content lands below the sticky bars: 16px under them, matching --sticky-top in style.css.
  const offset = view === 'diff' ? topbar + toolbar + 16 : topbar + 16;
  const items = view === 'guide' && guide ? chapters.map(chapter => chapter.id) : view === 'diff' ? shown.map(file => fileAnchor(file.path)) : [];
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      const index = ['1', '2', '3'].indexOf(event.key);
      if (index !== -1) { event.preventDefault(); void navigate(pullLink(repo, number, views[index][0])); return; }
      if ((event.key === 'f' || event.key === 'F') && view === 'diff') { event.preventDefault(); setTree(value => !value); return; }
      if (event.key === '/' && view === 'diff') { event.preventDefault(); setTree(true); requestAnimationFrame(() => filterInput.current?.focus()); return; }
      if ((event.key !== 'j' && event.key !== 'k') || !items.length) return;
      let at = -1;
      items.forEach((id, i) => { const top = document.getElementById(id)?.getBoundingClientRect().top ?? Infinity; if (top <= offset + 2) at = i; });
      event.preventDefault(); scrollToElement(items[Math.min(items.length - 1, Math.max(0, event.key === 'j' ? at + 1 : at - 1))], offset);
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [items.join('|'), view, offset]);
  useEffect(() => {
    // Tracks which section or file is being read, for the section rail and file tree.
    let frame = 0;
    const update = () => {
      frame = 0; let index = 0; items.forEach((id, i) => { const top = document.getElementById(id)?.getBoundingClientRect().top ?? Infinity; if (top <= offset + 8) index = i; }); setCurrent(index);
      // How far the reading line has moved through the current file; the sidebar row fills to match. Set directly to skip a render per frame.
      const box = document.getElementById(items[index])?.getBoundingClientRect();
      if (box && diffBody.current) diffBody.current.style.setProperty('--file-progress', String(Math.min(1, Math.max(0, (offset - box.top) / Math.max(1, box.height)))));
    };
    const onScroll = () => { frame ||= requestAnimationFrame(update); };
    update(); window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [items.join('|'), offset]);
  const files = new Map(snapshot.files.map(file => [file.path, file]));
  const setFileViewed = useCallback((paths: string[], value: boolean) => {
    setViewed(previous => value ? [...new Set([...previous, ...paths])] : previous.filter(path => !paths.includes(path)));
    if (value) setOpen(previous => ({ diff: previous.diff.filter(path => !paths.includes(path)), guide: previous.guide.filter(path => !paths.includes(path)) }));
  }, []);
  const markViewed = useCallback((path: string, value: boolean) => setFileViewed([path], value), [setFileViewed]);
  // The overview has no diffs; picking a file there opens it in Diff.
  const diffView: DiffView = view === 'guide' ? 'guide' : 'diff';
  const toggle = useCallback((path: string) => setOpen(previous => ({ ...previous, [diffView]: previous[diffView].includes(path) ? previous[diffView].filter(value => value !== path) : [...previous[diffView], path] })), [diffView]);
  function pickFile(path: string) {
    setOpen(previous => ({ ...previous, [diffView]: [...new Set([...previous[diffView], path])] }));
    if (view === 'overview') void navigate(pullLink(repo, number, 'diff'));
    if (view === 'guide') { setFilePreview(path, false); setSelected(guide?.chapters.flatMap(chapter => chapter.references).find(ref => ref.path === path) ?? null); }
    if (window.matchMedia('(max-width: 900px)').matches) setTree(false);
    requestAnimationFrame(() => scrollToElement(fileAnchor(path), offset, view === 'guide'));
  }
  function goToChapter(chapter: Chapter, expand = true) {
    const path = chapter.files.find(value => !viewed.includes(value));
    if (expand && path) setOpen(previous => ({ ...previous, guide: [...new Set([...previous.guide, path])] }));
    scrollToElement(chapter.id, offset);
  }
  const pull = { repo, number };
  const reviewApi = useMemo<ReviewApi>(() => ({
    viewer: detail.viewer, author: snapshot.author, threads: conversation.threads, drafts, composer, setComposer,
    addDraft: async (target, body) => { const draft = await addDraft({ data: { ...pull, headSHA: snapshot.headSHA, path: target.path, side: target.side, startLine: target.start < target.end ? target.start : null, line: target.end, body } }); onDetail(d => ({ ...d, drafts: [...d.drafts, draft] })); },
    updateDraft: async (id, body) => { const draft = await updateDraft({ data: { id, body } }); onDetail(d => ({ ...d, drafts: d.drafts.map(item => item.id === id ? draft : item) })); },
    deleteDraft: async id => { await deleteDraft({ data: { id } }); onDetail(d => ({ ...d, drafts: d.drafts.filter(item => item.id !== id) })); },
    reply: async (threadId, body) => { const next = await replyToThread({ data: { ...pull, commentId: threadId, body } }); onDetail(d => ({ ...d, conversation: next })); setToast('Reply posted to GitHub'); },
    commentMode: display.comments, focus, setFocus
  }), [detail.viewer, snapshot, conversation.threads, drafts, composer, display.comments, focus, setFocus]);
  async function submitReview(event: ReviewEvent, body: string) {
    const result = await postReview({ data: { ...pull, headSHA: snapshot.headSHA, event, body } });
    onDetail(d => ({ ...d, conversation: result.conversation, drafts: result.drafts }));
    setToast(event === 'APPROVE' ? 'Approved on GitHub' : event === 'REQUEST_CHANGES' ? 'Changes requested on GitHub' : 'Review submitted to GitHub');
  }
  function jumpToComment(anchor: string, path: string) {
    setFilePreview(path, false);
    setFocus(anchor);
    // Threads on lines no longer in the diff have nowhere to show in the code; they're in the Overview's activity.
    const thread = conversation.threads.find(item => `thread-${item.id}` === anchor);
    if (thread && (thread.outdated || thread.line === null)) { if (view !== 'overview') void navigate(pullLink(repo, number)); requestAnimationFrame(() => scrollToElement(`activity-${anchor}`, topbar + 16, true)); return; }
    if (!shown.some(file => file.path === path)) hidden.setEnabled(false);
    setOpen(previous => ({ ...previous, diff: [...new Set([...previous.diff, path])] }));
    if (view !== 'diff') void navigate(pullLink(repo, number, 'diff'));
    requestAnimationFrame(() => seekComment(anchor, fileAnchor(path), topbar + toolbar + 16));
  }
  const showDrafts = () => { const first = drafts[0]; if (first) { setFilePreview(first.path, false); if (view !== 'diff') void navigate(pullLink(repo, number, 'diff')); requestAnimationFrame(() => pickFile(first.path)); } };
  const limitations = [...snapshot.warnings, ...(guide?.limitations ?? []), ...(guide?.omissions.map(o => `${o.path}: ${o.reason}`) ?? [])];
  const changedFiles = shown.filter(file => contains(filter, file.path));
  const additions = shown.reduce((sum, file) => sum + file.additions, 0), deletions = shown.reduce((sum, file) => sum + file.deletions, 0);
  // Changed lines in visible files you haven't marked reviewed.
  const linesLeft = shown.filter(file => !viewed.includes(file.path)).reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const currentPath = shown[current]?.path ?? null;
  // Expand and collapse act on the files of the page you're on, skipping hidden ones.
  const pageFiles = view === 'guide' ? chapters.flatMap(chapter => chapter.files) : shown.map(file => file.path);
  // ⌘F searches the diffs on this page. Collapsed files are searched only when that toggle is on; a match in one opens it.
  const [find, setFind] = useState({ open: false, query: '', index: 0, focus: 0 });
  const [includeCollapsed, setIncludeCollapsed] = useState(() => readStored<unknown>(findCollapsedKey, false) === true);
  useEffect(() => { writeStored(findCollapsedKey, includeCollapsed); }, [includeCollapsed]);
  const matches = useMemo(() => {
    if (!find.open || !find.query) return [];
    const candidates = pageFiles.filter(path => includeCollapsed || open[diffView].includes(path)).map(path => files.get(path)!).filter(Boolean);
    return findMatches(candidates, find.query);
  }, [find.open, find.query, pageFiles.join('\n'), includeCollapsed, open[diffView].join('\n')]);
  const findIndex = matches.length ? Math.min(find.index, matches.length - 1) : 0;
  useFindHighlights(find.open ? matches : [], findIndex);
  function goToMatch(index: number) {
    const match = matches[index]; if (!match) return;
    setFilePreview(match.path, false);
    setFind(previous => ({ ...previous, index }));
    if (!open[diffView].includes(match.path)) setOpen(previous => ({ ...previous, [diffView]: [...previous[diffView], match.path] }));
    requestAnimationFrame(() => scrollToMatch(match, offset));
  }
  const stepMatch = (direction: 1 | -1) => { if (matches.length) goToMatch((findIndex + direction + matches.length) % matches.length); };
  // Typing jumps to the first match in or after the file you're reading.
  useEffect(() => {
    if (!find.open || !find.query || !matches.length) return;
    const timer = setTimeout(() => { const from = pageFiles.indexOf(currentPath ?? ''); const index = matches.findIndex(match => pageFiles.indexOf(match.path) >= from); goToMatch(Math.max(0, index)); }, 150);
    return () => clearTimeout(timer);
  }, [find.query, find.open]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || view === 'overview') return;
      const key = event.key.toLowerCase();
      if (key === 'f') { event.preventDefault(); setFind(previous => ({ ...previous, open: true, focus: previous.focus + 1 })); }
      else if (key === 'g' && find.open) { event.preventDefault(); stepMatch(event.shiftKey ? -1 : 1); }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const displayMenu = <DisplayMenu positionMethod={view === 'diff' ? 'fixed' : undefined} display={display} onChange={setDisplay} onReset={resetDisplay} onExpand={() => setOpen(previous => ({ ...previous, [diffView]: pageFiles }))} onCollapse={() => setOpen(previous => ({ ...previous, [diffView]: [] }))} />;
  const heading = <PullHeading snapshot={snapshot} color={color} />;
  return <DiffProvider source={{ repo, base: snapshot.baseSHA, head: snapshot.headSHA }}><ReviewContext.Provider value={reviewApi}><div className={`pr-page view-${view}`}>
    <header className="pr-topbar">
      <Tip content="Pull requests" side="bottom"><Link {...homeLink()} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} aria-label="Pull requests"><ArrowLeft /></Link></Tip>
      <Tip content={`${repo} #${number}: ${snapshot.title}`} delay="long" side="bottom"><span className="topbar-title"><span className="topbar-number">#{number}</span><span>{snapshot.title}</span></span></Tip>
      <nav className="view-tabs" aria-label="View">{views.map(([name, label], i) => <Tip key={name} content={label} hotkey={String(i + 1)} delay="long" side="bottom"><Link {...pullLink(repo, number, name)} className={view === name ? 'is-active' : ''} aria-current={view === name ? 'page' : undefined}>{label}{name === 'guide' && analyzing && <LoaderCircle size={12} className="spinner" />}</Link></Tip>)}</nav>
      <div className="topbar-actions">
        <CommentsMenu threads={conversation.threads} drafts={drafts} files={snapshot.files.map(file => file.path)} onJump={jumpToComment} />
        <ReviewMenu pullKey={pullKey} drafts={drafts} isAuthor={Boolean(detail.viewer) && detail.viewer === snapshot.author} onSubmit={submitReview} onShowDrafts={showDrafts} />
      </div>
    </header>
    {view === 'overview' ? <OverviewView detail={detail} heading={heading} viewed={viewed} onFile={pickFile} />
      : view === 'guide' ? <div className="guide-page">
        <div className="guide-head">
          {heading}
          {guide?.summary && <p className="review-summary">{inline(guide.summary)}</p>}
          {review && <div className="guide-meta">
            <span>{review.model} · {snapshot.headSHA.slice(0, 7)}</span>
            <Tip content="Run analysis again for this commit" delay="long"><Button variant="ghost" size="xs" disabled={analyzing} onClick={() => onAnalyze(true)}><RotateCw size={12} />Re-analyze</Button></Tip>
            {staleFilters && <Tip content="Your hidden files changed since this guide was made. Re-analyze to match them." delay="short"><span className="guide-stale"><EyeOff size={12} />Made with different hidden files</span></Tip>}
            {limitations.length > 0 && <button type="button" className="limitations-link" onClick={() => { if (limitationsRef.current) { limitationsRef.current.open = true; scrollToElement('limitations', offset, true); } }}><CircleAlert size={13} />Scope and limitations · {limitations.length}</button>}
            <span className="guide-meta-end">{displayMenu}</span>
          </div>}
        </div>
        {status && <div className="review-status">{status}</div>}
        {guide ? <>
          <nav className="section-rail" aria-label="Sections">{chapters.map((chapter, index) => <Tip key={chapter.id} content={`${index + 1}. ${chapter.title}`} delay="instant" side="right"><button type="button" className={`${index === current ? 'is-current' : ''} ${done.includes(chapter.id) ? 'is-done' : ''}`} onClick={() => goToChapter(chapter, false)} aria-label={`Section ${index + 1}: ${chapter.title}`} aria-current={index === current ? 'location' : undefined} /></Tip>)}</nav>
          <div className="chapters">{chapters.map((chapter, index) => <ChapterSection key={chapter.id} chapter={chapter} index={index} total={chapters.length} next={chapters[index + 1]} done={done.includes(chapter.id)} files={chapter.files.map(path => files.get(path)!)} onMark={checked => setFileViewed(chapter.files, checked)} onNext={goToChapter} onFile={pickFile}
            diffs={chapter.files.map(path => <DiffCard key={path} file={files.get(path)!} open={open.guide.includes(path)} viewed={viewed.includes(path)} onToggle={toggle} onViewed={markViewed} display={display} reference={selected?.path === path ? selected : null} preview={previewed.includes(path)} onPreview={setFilePreview} />)} />)}</div>
          <GuideEnd done={done.length} total={chapters.length} url={snapshot.identity.url} />
          {limitations.length > 0 && <details className="limitations" id="limitations" ref={limitationsRef}><summary><ChevronRight size={12} className="chevron" />Scope and limitations · {limitations.length}</summary>{limitations.map((text, i) => <p key={i}>{text}</p>)}</details>}
        </> : <AnalyzePrompt analyzing={analyzing} prior={detail.prior} onAnalyze={() => onAnalyze(false)} />}
      </div>
      : <div className="diff-page">
        <div className="diff-toolbar">
          <Tip content={tree ? 'Hide files' : 'Show files'} hotkey="F" side="bottom"><Button variant={tree ? 'secondary' : 'ghost'} size="sm" aria-pressed={tree} onClick={() => setTree(value => !value)}><ListTree />Files</Button></Tip>
          <span className="toolbar-stat"><span className="added">+{additions.toLocaleString()}</span><span className="removed">−{deletions.toLocaleString()}</span></span>
          <span className="toolbar-progress">{shown.filter(file => viewed.includes(file.path)).length}/{shown.length} reviewed</span>
          <span className="toolbar-actions"><span className="toolbar-progress">{linesLeft.toLocaleString()} {linesLeft === 1 ? 'line' : 'lines'} left</span>{displayMenu}</span>
        </div>
        <div ref={diffBody} className={`diff-body ${tree ? 'with-tree' : ''}`} style={{ '--tree-width': `${treeWidth}px` } as CSSProperties}>
          {tree && <aside className="file-tree" aria-label="Files">
            <div className="file-tree-head"><InputGroup className="bg-card"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput ref={filterInput} value={filter} onChange={e => setFilter(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setFilter(''); e.currentTarget.blur(); } }} placeholder="Filter files" aria-label="Filter files" spellCheck={false} /><InputGroupAddon align="inline-end"><Kbd>/</Kbd></InputGroupAddon></InputGroup><FileDisplayMenu order={order} onOrder={setOrder} hidden={hidden} files={snapshot.files} /><Button variant="ghost" size="icon" className="file-tree-close" aria-label="Close files" onClick={() => setTree(false)}><X /></Button></div>
            {order === 'tree' ? <ChangedFileTree key={patterns.join('\n')} files={shown} viewed={viewed} current={currentPath} search={filter} onPick={pickFile} />
              : <ChangedFileList files={shown} viewed={viewed} current={currentPath} search={filter} onPick={pickFile} />}
            {!changedFiles.length && <p className="outline-empty">{filter ? `No files match “${filter}”.` : 'Every file is hidden.'}</p>}
            {filteredCount > 0 && <Tip content={hidden.enabled ? 'Show them' : 'Hide them'} delay="long"><button type="button" className="hidden-note" onClick={() => hidden.setEnabled(!hidden.enabled)}>{hidden.enabled ? <EyeOff size={13} /> : <Eye size={13} />}{filteredCount} filtered {filteredCount === 1 ? 'file' : 'files'} {hidden.enabled ? 'hidden' : 'visible'}</button></Tip>}
            <ResizeHandle className="file-tree-resize" label="Resize files sidebar" value={treeWidth} min={treeWidths.min} max={treeWidths.max} onChange={setTreeWidth} onReset={() => setTreeWidth(treeWidths.initial)} />
          </aside>}
          {tree && <div className="file-tree-scrim" onClick={() => setTree(false)} />}
          <div className="diff-panel">{shown.map(file => <DiffCard key={file.path} file={file} open={open.diff.includes(file.path)} viewed={viewed.includes(file.path)} onToggle={toggle} onViewed={markViewed} display={display} reference={null} preview={previewed.includes(file.path)} onPreview={setFilePreview} />)}</div>
        </div>
      </div>}
    {find.open && view !== 'overview' && <FindBar query={find.query} onQuery={query => setFind(previous => ({ ...previous, query, index: 0 }))} count={matches.length} current={findIndex} onStep={stepMatch}
      includeCollapsed={includeCollapsed} onIncludeCollapsed={setIncludeCollapsed} onClose={() => setFind(previous => ({ ...previous, open: false }))} focusKey={find.focus} />}
    {toast && <Toast message={toast} onDone={() => setToast('')} />}
  </div></ReviewContext.Provider></DiffProvider>;
}

function PullHeading({ snapshot, color }: { snapshot: Snapshot; color: string }) {
  const { owner, repo, number } = snapshot.identity;
  return <header className="pr-heading">
    <h1>{snapshot.title}</h1>
    <div className="review-meta">
      {snapshot.state && snapshot.state !== 'open' ? <span className={`state-chip ${snapshot.state}`}>{snapshot.state === 'merged' ? 'Merged' : 'Closed'}</span> : snapshot.draft ? <span className="state-chip draft">Draft</span> : null}
      <Avatar login={snapshot.author} size={18} /><span className="author">{snapshot.author}</span>
      <span className="meta-separator">·</span><span className="meta-repo"><RepoSwatch color={color} size={7} />{owner}/{repo} #{number}</span>
      {snapshot.baseRef && snapshot.headRef && <><span className="meta-separator">·</span><span className="branches"><code>{snapshot.baseRef}</code>←<code>{snapshot.headRef}</code></span></>}
    </div>
  </header>;
}

const reviewTone: Record<string, { label: string; icon: ReactNode; tone: string }> = {
  APPROVED: { label: 'Approved', icon: <Check size={13} />, tone: 'approved' }, CHANGES_REQUESTED: { label: 'Changes requested', icon: <X size={13} />, tone: 'changes' },
  COMMENTED: { label: 'Commented', icon: <MessageSquare size={13} />, tone: 'commented' }, DISMISSED: { label: 'Dismissed', icon: <MessageSquare size={13} />, tone: 'commented' },
  REQUESTED: { label: 'Requested', icon: <Clock size={13} />, tone: 'requested' }
};
const checkLabels = { success: ['All passed', <ListChecks size={14} />], failure: ['Failing', <CircleX size={14} />], pending: ['Running', <Clock size={14} />] } as const;
function OverviewView({ detail, heading, viewed, onFile }: { detail: PullDetail; heading: ReactNode; viewed: string[]; onFile: (path: string) => void }) {
  const { snapshot, guide: review, status, conversation, viewer } = detail, guide = review?.guide ?? null;
  // One row per reviewer: a pending request wins, then their last approval or change request, then a comment.
  const reviewers = new Map<string, { name: string; team: boolean; state: string }>();
  for (const item of [...conversation.reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    if (item.author === snapshot.author) continue;
    const previous = reviewers.get(item.author);
    if (!previous || item.state !== 'COMMENTED' || previous.state === 'COMMENTED') reviewers.set(item.author, { name: item.author, team: false, state: item.state });
  }
  for (const request of status?.requested ?? []) reviewers.set(request.name, { ...request, state: 'REQUESTED' });
  const waiting = status?.requested.some(request => !request.team && request.name === viewer);
  const state = snapshot.state === 'merged' ? 'Merged' : snapshot.state === 'closed' ? 'Closed' : snapshot.draft ? 'Draft' : 'Open';
  const base = snapshot.baseRef || 'base';
  const merge = status?.merge ? { behind: `Behind ${base}`, conflicts: 'Has conflicts', blocked: 'Waiting on requirements', unstable: 'Checks not passing', clean: `Up to date with ${base}` }[status.merge] : null;
  const grouped = new Set(guide?.chapters.flatMap(chapter => chapter.files));
  const groups = guide ? [...guide.chapters.map(chapter => ({ title: chapter.title, files: chapter.files })), ...(snapshot.files.some(file => !grouped.has(file.path)) ? [{ title: 'Other files', files: snapshot.files.filter(file => !grouped.has(file.path)).map(file => file.path) }] : [])] : null;
  const fileButton = (path: string) => { const { name, directory } = splitPath(path), read = viewed.includes(path), file = snapshot.files.find(candidate => candidate.path === path); return <Tip key={path} content={path} delay="long" side="left"><button type="button" className={`side-file ${read ? 'is-read' : ''}`} onClick={() => onFile(path)}>{read ? <Check size={12} className="read-icon" /> : <FileCode2 size={12} />}<span className="filename">{name}</span><span className="directory">{directory}</span>{file && <FileCount file={file} />}</button></Tip>; };
  const stats = (paths: string[]) => { const list = paths.map(path => snapshot.files.find(file => file.path === path)).filter((file): file is ChangedFile => Boolean(file)); return <span className="file-count"><span className="added">+{list.reduce((sum, file) => sum + file.additions, 0).toLocaleString()}</span><span className="removed">−{list.reduce((sum, file) => sum + file.deletions, 0).toLocaleString()}</span></span>; };
  return <div className="overview-layout">
    <main className="overview-main">
      {heading}
      <details className="description" open>
        <summary>Description<ChevronDown size={12} className="chevron" /></summary>
        {snapshot.body.trim() ? <Markdown className="description-text" text={snapshot.body} /> : <p className="description-text is-empty">No description provided.</p>}
      </details>
      <Activity conversation={conversation} opened={{ author: snapshot.author, at: snapshot.createdAt ?? '', commits: status?.commits ?? 0 }} onFile={onFile} />
    </main>
    <aside className="overview-side" aria-label="Details">
      <section><h4>Status</h4><div className="side-row"><PullIcon draft={snapshot.draft} state={snapshot.state} size={15} /><span>{state}</span>{waiting && <span className="side-chip">Waiting for your review</span>}</div></section>
      <section><h4>Reviewers</h4>{reviewers.size ? [...reviewers.values()].map(reviewer => { const tone = reviewTone[reviewer.state] ?? reviewTone.COMMENTED; return <div key={reviewer.name} className="side-row">
        {reviewer.team ? <span className="side-team"><Users size={11} /></span> : <Avatar login={reviewer.name} size={18} />}<span>{reviewer.name}</span><Tip content={tone.label} delay="instant"><span className={`side-state ${tone.tone}`} aria-label={tone.label}>{tone.icon}</span></Tip>
      </div>; }) : <p className="side-empty">No reviewers yet</p>}</section>
      {status?.checks && <section><h4>Checks</h4><div className={`side-row checks-${status.checks}`}>{checkLabels[status.checks][1]}<span>{checkLabels[status.checks][0]}</span></div></section>}
      {merge && <section><h4>Branch</h4><div className={`side-row merge-${status!.merge}`}><GitBranch size={14} /><span>{merge}</span></div></section>}
      <section>
        <div className="side-files-head"><h4>{snapshot.files.length} {snapshot.files.length === 1 ? 'file' : 'files'} changed</h4>{stats(snapshot.files.map(file => file.path))}</div>
        {groups ? groups.map(group => <details key={group.title} className="side-group" open>
          <summary><span className="side-group-title">{group.title}</span><span className="side-count">{group.files.length}</span><ChevronDown size={12} className="chevron" />{stats(group.files)}</summary>
          <div className="side-files">{group.files.map(fileButton)}</div>
        </details>) : <div className="side-files">{snapshot.files.map(file => fileButton(file.path))}</div>}
      </section>
      <p className="side-footer">Head {snapshot.headSHA.slice(0, 7)}{review ? ` · guide by ${review.model}` : ''}</p>
    </aside>
  </div>;
}

function AnalyzePrompt({ analyzing, prior, onAnalyze }: { analyzing: boolean; prior: PullDetail['prior']; onAnalyze: () => void }) {
  const now = useNow();
  return <div className="analyze-empty">
    <h2>Get a guided walkthrough</h2>
    <p>Analysis groups this pull request’s changes into sections by intent, explains the before and after, and suggests questions worth checking. It sends the diff to Codex and usually takes a few minutes. The result is saved for this commit, so it only runs again when new commits are pushed.</p>
    {prior && <p className="analyze-prior">Last analyzed at <code>{prior.headSHA.slice(0, 7)}</code> {agoLong(prior.generatedAt, now)}. New commits have been pushed since.</p>}
    <Button onClick={onAnalyze} disabled={analyzing}>{analyzing && <LoaderCircle className="spinner" />}{analyzing ? 'Analyzing…' : 'Analyze'}</Button>
  </div>;
}

function GuideEnd({ done, total, url }: { done: number; total: number; url: string }) {
  const allDone = done === total;
  return <footer className="guide-end">
    <div className={`guide-end-status ${allDone ? 'is-done' : ''}`}>{allDone ? <CircleCheck size={18} /> : <span className="guide-end-count">{done}/{total}</span>}<div><p>{allDone ? `All ${total} sections reviewed` : `${total - done} of ${total} sections left to review`}</p><small>When you’re ready, use Review to comment, approve or request changes.</small></div></div>
    <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={url} target="_blank" rel="noreferrer">Open on GitHub<ExternalLink /></a>
  </footer>;
}

function DisplayMenu({ display, onChange, onReset, onExpand, onCollapse, positionMethod }: { display: DisplaySettings; onChange: (patch: Partial<DisplaySettings>) => void; onReset: () => void; onExpand: () => void; onCollapse: () => void } & Pick<ComponentProps<typeof PopoverContent>, 'positionMethod'>) {
  const [open, setOpen] = useState(false), act = (action: () => void) => () => { action(); setOpen(false); };
  const toggles: [keyof DisplaySettings, string][] = [['wrap', 'Wrap long lines'], ['wordDiff', 'Highlight changed words'], ['lineNumbers', 'Line numbers']];
  return <Popover open={open} onOpenChange={setOpen}>
    <Tip content="Display settings" side="bottom"><PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Display settings" />}><SlidersHorizontal /></PopoverTrigger></Tip>
    <PopoverContent positionMethod={positionMethod} side="bottom" align="end" sideOffset={6} className="display-popover" initialFocus={focusOnKeyboardOpen}>
      <PopoverTitle className="option-label">Diff view</PopoverTitle>
      <RadioRows label="Diff view" value={display.layout} onChange={layout => onChange({ layout })} options={[{ value: 'split', label: 'Split view' }, { value: 'unified', label: 'Unified view' }]} />
      <Separator className="my-1" />
      <CheckRow checked={display.whitespace === 'hide'} onChange={checked => onChange({ whitespace: checked ? 'hide' : 'show' })}>Hide whitespace</CheckRow>
      {toggles.map(([key, label]) => <CheckRow key={key} checked={display[key] as boolean} onChange={checked => onChange({ [key]: checked })}>{label}</CheckRow>)}
      <Separator className="my-1" />
      <span className="option-label">Comment location</span>
      <RadioRows label="Comment location" value={display.comments} onChange={comments => onChange({ comments })} options={[{ value: 'inline', label: 'Inline' }, { value: 'indicators', label: 'Indicators' }, { value: 'hidden', label: 'Hidden' }]} />
      <Separator className="my-1" />
      <label className="option-row option-field">Code size<FontSizeField value={display.fontSize} onChange={fontSize => onChange({ fontSize })} /></label>
      <Separator className="my-1" />
      <span className="option-label">Files</span>
      <Button variant="ghost" className="option-row" onClick={act(onExpand)}>Expand</Button>
      <Button variant="ghost" className="option-row" onClick={act(onCollapse)}>Collapse</Button>
      <Separator className="my-1" />
      <Button variant="ghost" className="option-row is-muted" onClick={act(onReset)}>Reset to defaults</Button>
    </PopoverContent>
  </Popover>;
}

// Commits valid sizes as you type and snaps anything out of range on blur.
function FontSizeField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = (raw: string) => { const next = Number(raw); if (raw.trim() && Number.isFinite(next) && next >= fontSizes.min && next <= fontSizes.max) onChange(clampFontSize(next)); };
  return <InputGroup className="h-7 w-[74px]">
    <InputGroupInput type="number" inputMode="decimal" min={fontSizes.min} max={fontSizes.max} step={0.5} value={text} aria-label="Code font size in pixels" className="text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      onChange={event => { setText(event.target.value); commit(event.target.value); }}
      onBlur={() => { const next = clampFontSize(Number(text) || value); setText(String(next)); onChange(next); }} />
    <InputGroupAddon align="inline-end" className="text-xs">px</InputGroupAddon>
  </InputGroup>;
}

function ChapterSection({ chapter, index, total, next, done, files, onMark, onNext, onFile, diffs }: { chapter: Chapter; index: number; total: number; next?: Chapter; done: boolean; files: ChangedFile[]; onMark: (checked: boolean) => void; onNext: (chapter: Chapter) => void; onFile: (path: string) => void; diffs: ReactNode }) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return <section className={`chapter-section ${done ? 'is-done' : ''}`} id={chapter.id}>
    <div className="explanation" tabIndex={0} aria-label={`${chapter.title} summary`}>
      <h2>{chapter.title}</h2>
      <div className="chapter-progress"><span className="chapter-count">{pad(index + 1)} / {pad(total)}</span><label className="chapter-reviewed"><Checkbox checked={done} onCheckedChange={checked => onMark(Boolean(checked))} aria-label={`Mark ${chapter.title} reviewed`} />Reviewed</label></div>
      <div className="chapter-copy"><p>{inline(chapter.purpose)}</p><p>{inline(chapter.behavior)}</p></div>
      {chapter.questions.length > 0 && <details className="review-questions"><summary><ChevronRight size={12} className="chevron" />Questions to consider<span className="count">{chapter.questions.length}</span></summary><ul>{chapter.questions.map((q, i) => <li key={i}>{inline(q)}</li>)}</ul></details>}
      <div className="chapter-files">{files.map(file => { const { name, directory } = splitPath(file.path); return <Tip key={file.path} content={file.path} delay="long"><button type="button" className="chapter-file" onClick={() => onFile(file.path)}><FileCode2 size={12} /><span className="filename">{name}</span><span className="directory">{directory}</span><FileCount file={file} /></button></Tip>; })}</div>
      {done && next && <Button variant="ghost" size="sm" className="self-start" onClick={() => onNext(next)}>Next section<ArrowDown size={12} /></Button>}
    </div>
    <div className="diff-panel" aria-label={`${chapter.title} diffs`}>{diffs}</div>
  </section>;
}
