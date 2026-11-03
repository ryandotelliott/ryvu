import type { ActivityDisplay } from './display';
import type { CommentThread, Conversation, PullCommit, ReviewComment, ReviewSummary } from '../types';

// A message in the Overview's activity: it has a header that folds it, and it is listed under Comments in the sidebar.
export type ActivityCard = { key: string; at: string; author: string; url: string; text: string; bot: boolean; collapsed: boolean }
  & ({ type: 'review'; review: ReviewSummary } | { type: 'comment'; comment: ReviewComment } | { type: 'thread'; thread: CommentThread });
// Everything else is a single line: the PR opening, a review without a summary, a commit.
export type ActivityEntry = ActivityCard
  | { type: 'opened'; key: string; at: string; author: string; commits: number }
  | { type: 'event'; key: string; at: string; review: ReviewSummary }
  | { type: 'commit'; key: string; at: string; commit: PullCommit };

export const isBot = (login: string) => /\[bot\]$/i.test(login);
export const cardId = (key: string) => `activity-${key}`;
// The first line of Markdown with its syntax stripped, for one-line previews. Link reference definitions never render,
// and bots use them to stash metadata, so they are skipped.
export function plainText(markdown: string) {
  return markdown.replace(/<!--[\s\S]*?-->/g, '').split('\n').filter(line => !/^ {0,3}\[[^\]]+\]:\s*\S/.test(line))
    .map(line => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').replace(/<[^>]+>|[`*_>#~|]|!?\[([^\]]*)\]\([^)]*\)/g, '$1').trim()).find(Boolean) ?? '';
}

// The PR's activity in display order: when it was opened, reviews, conversation comments, threads whose lines are no longer
// in the diff and, when shown, commits. Hidden resolved threads and bots are left out; the rest say whether they start folded.
export function activityEntries(conversation: Conversation, opened: { author: string; at: string; commits: number }, history: PullCommit[], display: ActivityDisplay): ActivityEntry[] {
  const fold = (bot: boolean, resolved = false) => (bot && display.bots === 'collapsed') || (resolved && display.resolved === 'collapsed');
  const entries: ActivityEntry[] = [{ type: 'opened', key: 'opened', at: opened.at, author: opened.author, commits: opened.commits }];
  for (const review of conversation.reviews) {
    const bot = isBot(review.author), key = `review-${review.id}`;
    if (bot && display.bots === 'hidden') continue;
    // A review that only commented starts folded; its threads carry the substance.
    entries.push(review.body.trim()
      ? { type: 'review', key, at: review.submittedAt, author: review.author, url: review.url, text: plainText(review.body), bot, collapsed: fold(bot) || review.state === 'COMMENTED', review }
      : { type: 'event', key, at: review.submittedAt, review });
  }
  for (const comment of conversation.comments) {
    const bot = isBot(comment.author);
    if (!(bot && display.bots === 'hidden')) entries.push({ type: 'comment', key: `comment-${comment.id}`, at: comment.createdAt, author: comment.author, url: comment.url, text: plainText(comment.body), bot, collapsed: fold(bot), comment });
  }
  for (const thread of conversation.threads) {
    const first = thread.comments[0];
    if (!thread.outdated || !first) continue;
    const bot = isBot(first.author);
    if ((bot && display.bots === 'hidden') || (thread.resolved && display.resolved === 'hidden')) continue;
    entries.push({ type: 'thread', key: `thread-${thread.id}`, at: first.createdAt, author: first.author, url: first.url, text: plainText(first.body), bot, collapsed: fold(bot, thread.resolved), thread });
  }
  if (display.commits) for (const commit of history) entries.push({ type: 'commit', key: `commit-${commit.sha}`, at: commit.at, commit });
  return entries.sort((a, b) => display.order === 'oldest' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at));
}
export const isCard = (entry: ActivityEntry): entry is ActivityCard => entry.type === 'review' || entry.type === 'comment' || entry.type === 'thread';
