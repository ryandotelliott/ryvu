import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronRight, CircleAlert, CornerDownRight, FileCode2, GitPullRequest, LoaderCircle, MessageSquare, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { agoLong, readStored, useNow, writeStored } from './browser-state';
import { Avatar, focusOnKeyboardOpen, Kbd, Segmented, Tip } from './ui';
import { Markdown } from './markdown';
import { commentAnchor, useReview } from './pull-page';
import { commandKey } from './shell';
import type { CommentMode } from './display';
import type { CommentThread, Conversation as ConversationData, DiffSide, DraftComment, ReviewComment, ReviewEvent } from '../types';

export type ComposerTarget = { path: string; side: DiffSide; start: number; end: number };
export type ReviewApi = {
  viewer: string; author: string;
  threads: CommentThread[]; drafts: DraftComment[];
  composer: ComposerTarget | null; setComposer: (target: ComposerTarget | null) => void;
  addDraft: (target: ComposerTarget, body: string) => Promise<void>;
  updateDraft: (id: string, body: string) => Promise<void>;
  deleteDraft: (id: string) => Promise<void>;
  reply: (threadId: number, body: string) => Promise<void>;
  // How comments show in diffs, and the comment last jumped to: it is revealed when hidden, opened as an indicator, or expanded inline.
  commentMode: CommentMode; focus: string | null; setFocus: (anchor: string | null) => void;
};
export type CommentData = { kind: 'thread'; thread: CommentThread } | { kind: 'draft'; draft: DraftComment };
// Indicators group every comment on one line into a single marker.
export type AnnotationData = CommentData | { kind: 'group'; items: CommentData[] } | { kind: 'composer'; target: ComposerTarget };
const plainText = (markdown: string) => markdown.split('\n').map(line => line.replace(/<[^>]+>|[`*_>#~]|!?\[([^\]]*)\]\([^)]*\)/g, '$1').trim()).find(Boolean) ?? '';
function commentSummary(data: CommentData) {
  if (data.kind === 'draft') return { author: '', text: plainText(data.draft.body), count: 1, line: lineLabel(data.draft.startLine, data.draft.line), pending: true, resolved: false, outdated: false };
  const { thread } = data, first = thread.comments[0], outdated = thread.outdated || thread.line === null;
  return { author: first?.author ?? '', text: plainText(first?.body ?? ''), count: thread.comments.length, line: outdated ? `old ${lineLabel(null, thread.originalLine ?? 0)}` : lineLabel(thread.startLine, thread.line!), pending: false, resolved: thread.resolved, outdated };
}

const lineLabel = (start: number | null, end: number) => start && start < end ? `lines ${start}–${end}` : `line ${end}`;
function submitOnShortcut(event: KeyboardEvent, submit: () => void, cancel?: () => void) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
  if (event.key === 'Escape' && cancel) { event.preventDefault(); cancel(); }
}

// A textarea with submit/cancel that reports failures inline.
function Editor({ initial = '', placeholder, submitLabel, onSubmit, onCancel, autoFocus = true }: { initial?: string; placeholder: string; submitLabel: string; onSubmit: (body: string) => Promise<void>; onCancel?: () => void; autoFocus?: boolean }) {
  const [body, setBody] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true); setError('');
    try { await onSubmit(body); setBody(''); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  return <div className="comment-editor">
    <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} rows={3} className="min-h-20 bg-card" onKeyDown={e => submitOnShortcut(e, () => void submit(), onCancel)} />
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="comment-editor-actions">
      <span className="comment-hint"><Kbd>{commandKey}↵</Kbd> to submit</span>
      {onCancel && <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>}
      <Button size="sm" onClick={() => void submit()} disabled={!body.trim() || busy}>{busy && <LoaderCircle className="spinner" />}{submitLabel}</Button>
    </div>
  </div>;
}

function CommentBody({ comment, now }: { comment: ReviewComment; now: number }) {
  return <div className="comment">
    <div className="comment-head"><Avatar login={comment.author} size={20} /><strong>{comment.author}</strong><Tip content={new Date(comment.createdAt).toLocaleString()} delay="long"><a href={comment.url} target="_blank" rel="noreferrer">{agoLong(comment.createdAt, now)}</a></Tip></div>
    <Markdown className="comment-text" text={comment.body} />
  </div>;
}

export function ThreadView({ thread, compact }: { thread: CommentThread; compact?: boolean }) {
  const review = useReview(), now = useNow(), [replying, setReplying] = useState(false);
  return <div className={`thread ${compact ? 'compact' : ''}`}>
    {thread.comments.map(comment => <CommentBody key={comment.id} comment={comment} now={now} />)}
    {review && (replying
      ? <Editor placeholder="Reply… (posts to GitHub right away)" submitLabel="Reply" onCancel={() => setReplying(false)} onSubmit={async body => { await review.reply(thread.id, body); setReplying(false); }} />
      : <Button variant="ghost" size="xs" className="self-start text-muted-foreground" onClick={() => setReplying(true)}><CornerDownRight size={13} />Reply</Button>)}
  </div>;
}

function DraftView({ draft }: { draft: DraftComment }) {
  const review = useReview()!, [editing, setEditing] = useState(false);
  return <div className="thread draft">
    <div className="comment">
        <div className="comment-head"><Avatar login={review.viewer || 'you'} size={20} /><strong>{review.viewer || 'You'}</strong><span className="pending-chip">Pending</span>
          {!editing && <span className="comment-tools"><Button variant="ghost" size="icon-xs" aria-label="Edit comment" onClick={() => setEditing(true)}><Pencil size={13} /></Button><Button variant="ghost" size="icon-xs" aria-label="Delete comment" onClick={() => void review.deleteDraft(draft.id)}><Trash2 size={13} /></Button></span>}
        </div>
        {editing ? <Editor initial={draft.body} placeholder="Edit comment" submitLabel="Save" onCancel={() => setEditing(false)} onSubmit={async body => { await review.updateDraft(draft.id, body); setEditing(false); }} /> : <Markdown className="comment-text" text={draft.body} />}
    </div>
  </div>;
}

function Composer({ target }: { target: ComposerTarget }) {
  const review = useReview()!;
  return <div className="thread composer">
    <div className="composer-label">Comment on {lineLabel(target.start < target.end ? target.start : null, target.end)}</div>
    <Editor placeholder="Leave a comment" submitLabel="Add to review" onCancel={() => review.setComposer(null)} onSubmit={async body => { await review.addDraft(target, body); review.setComposer(null); }} />
  </div>;
}

function CommentBlock({ data }: { data: CommentData }) {
  return data.kind === 'thread' ? <ThreadView thread={data.thread} /> : <DraftView draft={data.draft} />;
}
// An inline comment that folds to one line.
function CollapsibleComment({ data }: { data: CommentData }) {
  const review = useReview(), anchor = commentAnchor(data), summary = commentSummary(data), [open, setOpen] = useState(!summary.resolved);
  useEffect(() => { if (review?.focus === anchor) setOpen(true); }, [review?.focus, anchor]);
  return <Collapsible open={open} onOpenChange={setOpen} className={`comment-fold ${review?.focus === anchor ? 'is-focused' : ''}`}>
    <CollapsibleTrigger className="comment-fold-trigger"><ChevronRight size={13} className="chevron" />
      {open ? <span>{summary.pending ? 'Pending comment' : 'Comment'} on {summary.line}{summary.count > 1 ? ` · ${summary.count} comments` : ''}</span>
        : <>{summary.author && <strong>{summary.author}</strong>}{summary.pending && <span className="pending-chip">Pending</span>}<span className="comment-fold-text">{summary.text}</span>{summary.count > 1 && <span className="comment-fold-count">{summary.count}</span>}</>}
      {summary.resolved && <span className="resolved-chip">Resolved</span>}
    </CollapsibleTrigger>
    <CollapsibleContent><CommentBlock data={data} /></CollapsibleContent>
  </Collapsible>;
}
// A marker at the right end of the line that opens the line's comments in a popover.
function CommentIndicator({ items }: { items: CommentData[] }) {
  const review = useReview()!, anchors = items.map(commentAnchor), open = anchors.includes(review.focus ?? '');
  const count = items.reduce((sum, item) => sum + commentSummary(item).count, 0), pending = items.some(item => item.kind === 'draft');
  return <div className="comment-indicator-row" data-comment-anchor={anchors.join(' ')}>
    <Popover open={open} onOpenChange={next => review.setFocus(next ? anchors[0] : null)}>
      <Tip content={`${count} ${count === 1 ? 'comment' : 'comments'} on ${commentSummary(items[0]).line}`} delay="instant" side="left"><PopoverTrigger render={<button type="button" className={`comment-indicator ${pending ? 'is-pending' : ''} ${open ? 'is-open' : ''}`} aria-label={`${count} comments`} />}><MessageSquare size={11} />{count}</PopoverTrigger></Tip>
      <PopoverContent side="left" align="start" sideOffset={8} className="comment-popover" initialFocus={focusOnKeyboardOpen}><ScrollArea className="comment-popover-scroll"><div className="comment-popover-body">{items.map(item => <CommentBlock key={commentAnchor(item)} data={item} />)}</div></ScrollArea></PopoverContent>
    </Popover>
  </div>;
}
export function Annotation({ data }: { data: AnnotationData }) {
  if (data.kind === 'composer') return <div className="annotation"><Composer target={data.target} /></div>;
  if (data.kind === 'group') return <CommentIndicator items={data.items} />;
  return <div className="annotation" data-comment-anchor={commentAnchor(data)}><CollapsibleComment data={data} /></div>;
}

type MenuItem = { data: CommentData; path: string; line: number };
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable]'));
// Every comment on the diff, by file and line; resolved threads fold into their own section. Picking one jumps to it in the diff.
export function CommentsMenu({ threads, drafts, files, onJump }: { threads: CommentThread[]; drafts: DraftComment[]; files: string[]; onJump: (anchor: string, path: string) => void }) {
  const [open, setOpen] = useState(false), now = useNow(), popup = useRef<HTMLDivElement>(null);
  const position = (path: string) => { const index = files.indexOf(path); return index === -1 ? files.length : index; };
  // Outdated threads sort after the file's current ones, by their old line.
  const items: MenuItem[] = [...threads.map(thread => ({ data: { kind: 'thread', thread } as CommentData, path: thread.path, line: thread.line ?? 1e9 + (thread.originalLine ?? 0) })),
    ...drafts.map(draft => ({ data: { kind: 'draft', draft } as CommentData, path: draft.path, line: draft.line }))]
    .sort((a, b) => position(a.path) - position(b.path) || a.line - b.line);
  const isResolved = (item: MenuItem) => item.data.kind === 'thread' && item.data.thread.resolved;
  const byFile = (list: MenuItem[]) => list.reduce<{ path: string; items: MenuItem[] }[]>((groups, item) => { const last = groups[groups.length - 1]; if (last?.path === item.path) last.items.push(item); else groups.push({ path: item.path, items: [item] }); return groups; }, []);
  const active = items.filter(item => !isResolved(item)), resolved = items.filter(isResolved);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || (event.key !== 'c' && event.key !== 'C') || isTyping(event.target)) return;
      // Other dialogs keep the key; this menu's own popup closes on it.
      const dialog = event.target instanceof HTMLElement ? event.target.closest('[role="dialog"]') : null;
      if (dialog && !popup.current?.contains(dialog)) return;
      event.preventDefault(); setOpen(value => !value);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  const row = (item: MenuItem) => { const summary = commentSummary(item.data), at = item.data.kind === 'thread' ? item.data.thread.comments[0]?.createdAt : item.data.draft.createdAt;
    return <button type="button" key={commentAnchor(item.data)} className="comments-menu-item" onClick={() => { setOpen(false); onJump(commentAnchor(item.data), item.path); }}>
      <span className="comments-menu-head">{summary.pending ? <span className="pending-chip">Pending</span> : <><Avatar login={summary.author} size={16} /><strong>{summary.author}</strong></>}<span className="comments-menu-line">{summary.line}</span>{summary.outdated && <span className="outdated-chip">Outdated</span>}{at && <span className="comments-menu-time">{agoLong(at, now)}</span>}</span>
      <span className="comments-menu-text">{summary.text || 'No text'}</span>
      {summary.count > 1 && <span className="comments-menu-replies"><CornerDownRight size={11} />{summary.count - 1} {summary.count === 2 ? 'reply' : 'replies'}</span>}
    </button>; };
  const groups = (list: MenuItem[]) => byFile(list).map(group => <section key={group.path}><h5>{group.path}</h5>{group.items.map(row)}</section>);
  return <Popover open={open} onOpenChange={setOpen}>
    <Tip content="Comments" hotkey="C" side="bottom"><PopoverTrigger render={<Button variant="ghost" size="sm" aria-label={`${items.length} comments`} />}><MessageSquare />{items.length}</PopoverTrigger></Tip>
    <PopoverContent ref={popup} positionMethod="fixed" side="bottom" align="end" sideOffset={6} className="comments-menu overflow-hidden" initialFocus={focusOnKeyboardOpen}>
      <PopoverTitle className="comments-menu-title">Comments{resolved.length > 0 && <span className="comments-menu-count">{active.length} open · {resolved.length} resolved</span>}</PopoverTitle>
      <ScrollArea className="comments-menu-scroll">
        {!items.length && <p className="comments-menu-empty">No comments on this pull request’s code yet.</p>}
        {groups(active)}
        {resolved.length > 0 && <Collapsible className="comments-menu-resolved">
          <CollapsibleTrigger className="comment-fold-trigger"><ChevronRight size={13} className="chevron" />Resolved<span className="comment-fold-count">{resolved.length}</span></CollapsibleTrigger>
          <CollapsibleContent>{groups(resolved)}</CollapsibleContent>
        </Collapsible>}
      </ScrollArea>
    </PopoverContent>
  </Popover>;
}

const reviewStates: Record<string, { label: string; chip: string; tone: string; icon: ReactNode }> = {
  APPROVED: { label: 'approved these changes', chip: 'Approved', tone: 'approved', icon: <Check size={12} /> },
  CHANGES_REQUESTED: { label: 'requested changes', chip: 'Changes requested', tone: 'changes', icon: <X size={12} /> },
  COMMENTED: { label: 'reviewed', chip: 'Reviewed', tone: 'commented', icon: <MessageSquare size={12} /> },
  DISMISSED: { label: 'left a dismissed review', chip: 'Dismissed', tone: 'commented', icon: <MessageSquare size={12} /> }
};
type Order = 'oldest' | 'newest';
const orderKey = 'pr-guide:conversation-order';
function ActivityEvent({ icon, at, now, children }: { icon: ReactNode; at: string; now: number; children: ReactNode }) {
  return <div className="activity-event">{icon}<span>{children}{at && <> · <Tip content={new Date(at).toLocaleString()} delay="long"><time dateTime={at}>{agoLong(at, now)}</time></Tip></>}</span></div>;
}
// The PR's activity: when it was opened, reviews, conversation comments and threads whose lines are no longer in the diff.
// Messages are cards; reviews without a summary are single event lines.
export function Activity({ conversation, opened, onFile }: { conversation: ConversationData; opened: { author: string; at: string; commits: number }; onFile: (path: string) => void }) {
  const now = useNow(), [order, setOrder] = useState<Order>(() => readStored<unknown>(orderKey, 'oldest') === 'newest' ? 'newest' : 'oldest');
  useEffect(() => { writeStored(orderKey, order); }, [order]);
  const items: { at: string; key: string; node: ReactNode }[] = [
    { at: opened.at, key: 'opened', node: <ActivityEvent icon={<GitPullRequest size={14} className="text-(--success)" />} at={opened.at} now={now}><strong>{opened.author}</strong> opened this pull request{opened.commits ? ` with ${opened.commits} ${opened.commits === 1 ? 'commit' : 'commits'}` : ''}</ActivityEvent> },
    ...conversation.reviews.map(review => { const state = reviewStates[review.state]; return { at: review.submittedAt, key: `review-${review.id}`, node: review.body.trim()
      ? <article className="activity-card"><div className="comment">
          <div className="comment-head"><Avatar login={review.author} size={20} /><strong>{review.author}</strong><Tip content={new Date(review.submittedAt).toLocaleString()} delay="long"><a href={review.url} target="_blank" rel="noreferrer">{agoLong(review.submittedAt, now)}</a></Tip><span className={`review-chip ${state.tone}`}>{state.icon}{state.chip}</span></div>
          <Markdown className="comment-text" text={review.body} />
        </div></article>
      : <ActivityEvent icon={<span className={`review-state ${state.tone}`}>{state.icon}</span>} at={review.submittedAt} now={now}><strong>{review.author}</strong> <span className={`review-state ${state.tone}`}>{state.label}</span></ActivityEvent> }; }),
    ...conversation.comments.map(comment => ({ at: comment.createdAt, key: `comment-${comment.id}`, node: <article className="activity-card"><CommentBody comment={comment} now={now} /></article> })),
    ...conversation.threads.filter(thread => thread.outdated || thread.line === null).map(thread => ({ at: thread.comments[0].createdAt, key: `thread-${thread.id}`, node: <article className="activity-card" id={`activity-thread-${thread.id}`}>
      <button type="button" className="timeline-file" onClick={() => onFile(thread.path)}><FileCode2 size={12} />{thread.path}{thread.originalLine ? `:${thread.originalLine}` : ''}<span className="outdated-chip">Outdated</span></button>
      <ThreadView thread={thread} compact />
    </article> }))
  ].sort((a, b) => order === 'oldest' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at));
  return <section className="activity" aria-label="Activity">
    <div className="activity-bar"><h3>Activity</h3>{items.length > 2 && <Segmented label="Order" value={order} onChange={setOrder} options={[{ value: 'oldest', label: 'Oldest first' }, { value: 'newest', label: 'Newest first' }]} />}</div>
    {items.map(item => <div key={item.key} className="activity-item">{item.node}</div>)}
  </section>;
}

// "Finish your review": summary, verdict and the pending comments, submitted together.
export function ReviewMenu({ pullKey, drafts, isAuthor, onSubmit, onShowDrafts }: { pullKey: string; drafts: DraftComment[]; isAuthor: boolean; onSubmit: (event: ReviewEvent, body: string) => Promise<void>; onShowDrafts: () => void }) {
  const storageKey = `pr-guide:review-draft:${pullKey}`;
  const [body, setBody] = useState(() => readStored<string>(storageKey, '')), [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { writeStored(storageKey, body); }, [body, storageKey]);
  const options: { value: ReviewEvent; label: string; detail: string; disabled?: boolean }[] = [
    { value: 'COMMENT', label: 'Comment', detail: 'General feedback without a verdict.' },
    { value: 'APPROVE', label: 'Approve', detail: isAuthor ? 'You can’t approve your own pull request.' : 'Ready to merge from your side.', disabled: isAuthor },
    { value: 'REQUEST_CHANGES', label: 'Request changes', detail: isAuthor ? 'You can’t request changes on your own pull request.' : 'Feedback that must be addressed first.', disabled: isAuthor }
  ];
  const ready = event === 'APPROVE' || (event === 'REQUEST_CHANGES' ? body.trim().length > 0 : body.trim().length > 0 || drafts.length > 0);
  async function submit() {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try { await onSubmit(event, body); setBody(''); setEvent('COMMENT'); setOpen(false); } catch (e) { setError(e instanceof Error ? e.message : 'The review could not be submitted.'); } finally { setBusy(false); }
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button size="sm" />}>
      Submit review{drafts.length > 0 && <span className="review-count">{drafts.length}</span>}
    </PopoverTrigger>
    <PopoverContent positionMethod="fixed" side="bottom" align="end" sideOffset={6} className="w-[380px] gap-3 p-3.5" initialFocus={area}>
      <PopoverTitle className="text-sm font-semibold">Finish your review</PopoverTitle>
      <Textarea ref={area} value={body} onChange={e => setBody(e.target.value)} placeholder="Leave a summary (optional for approvals)" rows={4} className="min-h-20" onKeyDown={e => submitOnShortcut(e, () => void submit())} />
      <RadioGroup aria-label="Review verdict" value={event} onValueChange={value => setEvent(value as ReviewEvent)} className="gap-0.5">
        {options.map(option => <Label key={option.value} className={`items-start font-normal leading-normal review-option ${option.disabled ? 'is-disabled' : ''}`}>
          <RadioGroupItem value={option.value} disabled={option.disabled} className="mt-0.5" />
          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
        </Label>)}
      </RadioGroup>
      {error && <div className="review-error" role="alert"><CircleAlert size={14} />{error}</div>}
      <footer className="review-popup-footer">
        {drafts.length ? <Button variant="ghost" size="xs" onClick={() => { setOpen(false); onShowDrafts(); }}>{drafts.length} pending {drafts.length === 1 ? 'comment' : 'comments'}</Button> : <span>No pending comments</span>}
        <Button size="sm" onClick={() => void submit()} disabled={!ready || busy}>{busy ? <LoaderCircle className="spinner" /> : <Check />}Submit review</Button>
      </footer>
    </PopoverContent>
  </Popover>;
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const timer = setTimeout(onDone, 3200); return () => clearTimeout(timer); }, [message]);
  return <div className="toast" role="status"><Check size={14} />{message}<Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDone}><X size={13} /></Button></div>;
}
