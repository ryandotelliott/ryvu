import { createContext, useContext, type RefObject } from 'react';
import type { Virtualizer } from '@pierre/diffs';
import type { CommentData, ReviewApi } from './comments';
import type { DiffSource } from './diff';

// comments.tsx and diff.tsx export only components so Fast Refresh updates them in place, and these contexts and the
// page's virtualizer outlive those updates.
export const ReviewContext = createContext<ReviewApi | null>(null);
export const useReview = () => useContext(ReviewContext);
export const DiffSourceContext = createContext<DiffSource | null>(null);

export const commentAnchor = (data: CommentData) => data.kind === 'thread' ? `thread-${data.thread.id}` : `draft-${data.draft.id}`;
export const fileAnchor = (path: string) => `file-${encodeURIComponent(path).replace(/%/g, '_')}`;
// A range's name, bottom PR first, from its PRs listed top first.
export const rangeLabel = (pulls: readonly { number: number }[]) => `#${pulls[pulls.length - 1].number} – #${pulls[0].number}`;
export function splitPath(path: string) { const parts = path.split('/'); const name = parts.pop()!; return { name, directory: parts.length ? `${parts.join('/')}/` : '' }; }

// The page's virtualizer, so programmatic scrolls can tell it the scroll position changed (see scrollPageBy).
export const pageVirtualizer: RefObject<Virtualizer | null> = { current: null };
// Scroll the page from code. The virtualizer caches the scroll position until the browser's next scroll event, and a
// diff that re-measures itself before then (a jump usually re-renders too) stores a wrong position and draws nothing.
// Marking it dirty right away makes any measurement read the real position.
export function scrollPageBy(delta: number) {
  window.scrollBy(0, delta);
  pageVirtualizer.current?.markDOMDirty();
}
