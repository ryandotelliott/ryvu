import { useEffect, useRef, type ReactNode } from 'react';
import { Check, ChevronRight, FileCode2, GitCommitHorizontal, GitPullRequest, MessageSquare, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ago, agoLong, useNow } from './browser-state';
import { ThreadView } from './comments';
import { cardId, type ActivityCard, type ActivityEntry } from './activity-items';
import { contains } from './fuzzy';
import { Markdown } from './markdown';
import { splitPath } from './pull-page';
import { Avatar, focusOnKeyboardOpen, Segmented, Switch, Tip } from './ui';
import type { ActivityDisplay, Visibility } from './display';
import type { ReviewSummary } from '../types';

const reviewStates: Record<string, { label: string; chip: string; tone: string; icon: ReactNode }> = {
  APPROVED: { label: 'approved these changes', chip: 'Approved', tone: 'approved', icon: <Check size={12} /> },
  CHANGES_REQUESTED: { label: 'requested changes', chip: 'Changes requested', tone: 'changes', icon: <X size={12} /> },
  COMMENTED: { label: 'reviewed', chip: 'Reviewed', tone: 'commented', icon: <MessageSquare size={12} /> },
  DISMISSED: { label: 'left a dismissed review', chip: 'Dismissed', tone: 'commented', icon: <MessageSquare size={12} /> }
};
const lineSuffix = (line: number | null) => line ? `:${line}` : '';

function ActivityEvent({ icon, at, now, children }: { icon: ReactNode; at: string; now: number; children: ReactNode }) {
  return <div className="activity-event">{icon}<span>{children}{at && <> · <Tip content={new Date(at).toLocaleString()} delay="long"><time dateTime={at}>{agoLong(at, now)}</time></Tip></>}</span></div>;
}

function ReviewEvent({ review, now }: { review: ReviewSummary; now: number }) {
  const { tone, icon, label } = reviewStates[review.state];
  return <ActivityEvent icon={<span className={`review-state ${tone}`}>{icon}</span>} at={review.submittedAt} now={now}><strong>{review.author}</strong> <span className={`review-state ${tone}`}>{label}</span></ActivityEvent>;
}

function CardTags({ card, open }: { card: ActivityCard; open: boolean }) {
  if (card.type === 'review') { const state = reviewStates[card.review.state]; return <span className="activity-card-tags"><span className={`review-chip ${state.tone}`}>{state.icon}{state.chip}</span></span>; }
  if (card.type !== 'thread') return null;
  const replies = card.thread.comments.length - 1;
  return <span className="activity-card-tags">
    {!open && replies > 0 && <span className="comment-fold-count">{replies} {replies === 1 ? 'reply' : 'replies'}</span>}
    <span className="tag">Outdated</span>{card.thread.resolved && <span className="tag"><Check size={11} />Resolved</span>}
  </span>;
}

// A message whose header folds it. Folded content stays in the page, so find and the browser's own search reach it.
function ActivityCardView({ card, open, onOpenChange, now, onFile }: { card: ActivityCard; open: boolean; onOpenChange: (open: boolean) => void; now: number; onFile: (path: string) => void }) {
  const noun = card.type === 'review' ? 'review' : card.type === 'thread' ? 'thread' : 'comment';
  return <Collapsible open={open} onOpenChange={next => onOpenChange(next)} render={<article className={`activity-card ${open ? '' : 'is-collapsed'}`} id={cardId(card.key)} data-activity-key={card.key} />}>
    <div className="activity-card-head" onClick={event => { if (!(event.target as HTMLElement).closest('a, button')) onOpenChange(!open); }}>
      <CollapsibleTrigger className="activity-card-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${card.author}’s ${noun}`}><ChevronRight size={13} className="chevron" /></CollapsibleTrigger>
      <Avatar login={card.author} size={20} /><strong>{card.author}</strong>
      <Tip content={new Date(card.at).toLocaleString()} delay="long"><a href={card.url} target="_blank" rel="noreferrer">{agoLong(card.at, now)}</a></Tip>
      {!open && <span className="activity-card-preview">{card.text}</span>}
      <CardTags card={card} open={open} />
    </div>
    <CollapsibleContent hiddenUntilFound className="activity-card-body">
      {card.type === 'thread' ? <>
        <button type="button" className="activity-file" onClick={() => onFile(card.thread.path)}><FileCode2 size={12} />{card.thread.path}{lineSuffix(card.thread.originalLine)}</button>
        <ThreadView thread={card.thread} compact hideFirstHead />
      </> : <Markdown className="comment-text" text={card.type === 'review' ? card.review.body : card.comment.body} />}
    </CollapsibleContent>
  </Collapsible>;
}

// The PR's activity. Messages are cards with a folding header; reviews without a summary, the opening and commits are single lines.
export function Activity({ entries, isOpen, onOpenChange, display, onDisplay, onFile, pullUrl }: { entries: ActivityEntry[]; isOpen: (card: ActivityCard) => boolean; onOpenChange: (key: string, open: boolean) => void; display: ActivityDisplay; onDisplay: (patch: Partial<ActivityDisplay>) => void; onFile: (path: string) => void; pullUrl: string }) {
  const now = useNow();
  return <section className="activity" aria-label="Activity">
    <div className="activity-bar"><h3>Activity</h3><ActivityDisplayMenu display={display} onChange={onDisplay} /></div>
    {entries.map(entry => <div key={entry.key} className="activity-item">{
      entry.type === 'opened' ? <ActivityEvent icon={<GitPullRequest size={14} className="text-(--success)" />} at={entry.at} now={now}><strong>{entry.author}</strong> opened this pull request{entry.commits ? ` with ${entry.commits} ${entry.commits === 1 ? 'commit' : 'commits'}` : ''}</ActivityEvent>
      : entry.type === 'event' ? <ReviewEvent review={entry.review} now={now} />
      : entry.type === 'commit' ? <ActivityEvent icon={<GitCommitHorizontal size={14} />} at={entry.at} now={now}><strong>{entry.commit.author}</strong> pushed <a className="commit-sha" href={`${pullUrl}/commits/${entry.commit.sha}`} target="_blank" rel="noreferrer">{entry.commit.sha.slice(0, 7)}</a> <span className="commit-message">{entry.commit.message}</span></ActivityEvent>
      : <ActivityCardView card={entry} open={isOpen(entry)} onOpenChange={open => onOpenChange(entry.key, open)} now={now} onFile={onFile} />
    }</div>)}
  </section>;
}

const visibilityOptions: { value: Visibility; label: string }[] = [{ value: 'visible', label: 'Visible' }, { value: 'collapsed', label: 'Collapsed' }, { value: 'hidden', label: 'Hidden' }];
function ActivityDisplayMenu({ display, onChange }: { display: ActivityDisplay; onChange: (patch: Partial<ActivityDisplay>) => void }) {
  return <Popover>
    <Tip content="Activity display" side="bottom"><PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Activity display" />}><SlidersHorizontal /></PopoverTrigger></Tip>
    <PopoverContent side="bottom" align="end" sideOffset={6} className="w-[280px] gap-0 p-0" initialFocus={focusOnKeyboardOpen}>
      <PopoverTitle className="sr-only">Activity display</PopoverTitle>
      <div className="file-menu-section"><span className="file-menu-title">Order</span><Segmented label="Order" value={display.order} onChange={order => onChange({ order })} options={[{ value: 'oldest', label: 'Oldest first' }, { value: 'newest', label: 'Newest first' }]} /></div>
      <div className="file-menu-section"><span className="file-menu-title">Resolved comments</span><Segmented label="Resolved comments" value={display.resolved} onChange={resolved => onChange({ resolved })} options={visibilityOptions} /></div>
      <div className="file-menu-section"><span className="file-menu-title">Bot comments</span><Segmented label="Bot comments" value={display.bots} onChange={bots => onChange({ bots })} options={visibilityOptions} /></div>
      <div className="file-menu-section"><label className="file-menu-row">Show commits<Switch label="Show commits" checked={display.commits} onChange={commits => onChange({ commits })} /></label></div>
    </PopoverContent>
  </Popover>;
}

// The Overview's messages in the sidebar: who wrote each and its first lines. `current` follows the one being read.
export function CommentList({ cards, current, search, onPick }: { cards: ActivityCard[]; current: string | null; search: string; onPick: (key: string) => void }) {
  const now = useNow(), list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' }); }, [current, search]);
  const shown = cards.filter(card => contains(search, `${card.author} ${card.text} ${card.type === 'thread' ? card.thread.path : ''}`));
  return <div className="comment-list" ref={list}>{shown.map(card => <button key={card.key} type="button" className={`comment-row ${card.key === current ? 'is-current' : ''}`} onClick={() => onPick(card.key)}>
    <span className="comment-row-meta"><Avatar login={card.author} size={16} tooltip={false} /><span className="comment-row-author">{card.author}</span><Tip content={new Date(card.at).toLocaleString()} delay="long"><time dateTime={card.at}>{ago(card.at, now)}</time></Tip></span>
    <span className="comment-row-text">{card.text || <em>No text</em>}</span>
    {card.type === 'thread' ? <span className="comment-row-foot"><FileCode2 size={12} /><span className="truncate">{splitPath(card.thread.path).name}{lineSuffix(card.thread.originalLine)}</span>{card.thread.resolved && <span className="tag">Resolved</span>}</span>
      : card.type === 'review' ? <span className={`comment-row-foot review-state ${reviewStates[card.review.state].tone}`}>{reviewStates[card.review.state].icon}{reviewStates[card.review.state].chip}</span> : null}
  </button>)}{cards.length > 0 && !shown.length && <p className="outline-empty">No comments match “{search}”.</p>}</div>;
}
