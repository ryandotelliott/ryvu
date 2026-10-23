import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, FoldVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Toggle } from '@/components/ui/toggle';
import { fileAnchor, scrollPageBy } from './pull-page';
import { Tip } from './ui';
import type { ChangedFile } from '../types';

export type FindMatch = { path: string; side: 'additions' | 'deletions'; line: number; start: number; end: number };

// Every case-insensitive occurrence of `query` in the files' diff lines, in file and line order.
export function findMatches(files: ChangedFile[], query: string): FindMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];
  for (const file of files) for (const line of file.lines) {
    const text = line.text.toLowerCase(), side = line.kind === 'remove' ? 'deletions' : 'additions', number = side === 'deletions' ? line.oldLine : line.newLine;
    if (number === null) continue;
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) matches.push({ path: file.path, side, line: number, start: at, end: at + needle.length });
  }
  return matches;
}

// The rendered row for a match, if the diff has drawn it. Context lines show on both sides; either copy will do.
function rowFor(match: FindMatch): Element | null {
  const root = document.getElementById(fileAnchor(match.path))?.querySelector('diffs-container')?.shadowRoot;
  if (!root) return null;
  const types = match.side === 'deletions' ? ['change-deletion', 'context'] : ['change-addition', 'context'];
  for (const type of types) {
    const row = Array.from(root.querySelectorAll(`[data-line="${match.line}"][data-line-type="${type}"]`)).find(element => element.getClientRects().length > 0);
    if (row) return row;
  }
  return null;
}
function rangeFor(row: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT), range = document.createRange();
  let offset = 0, started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < offset + length) { range.setStart(node, start - offset); started = true; }
    if (started && end <= offset + length) { range.setEnd(node, end - offset); return range; }
    offset += length;
  }
  return null;
}

// Marks the matches that are on screen. The diff draws rows lazily, so this reruns as you scroll.
export function useFindHighlights(matches: FindMatch[], current: number) {
  useEffect(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (!highlights || typeof Highlight === 'undefined' || !matches.length) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const others: Range[] = [], active: Range[] = [];
      matches.forEach((match, index) => {
        const card = document.getElementById(fileAnchor(match.path))?.getBoundingClientRect();
        if (!card || card.bottom < 0 || card.top > window.innerHeight) return;
        const row = rowFor(match), range = row && rangeFor(row, match.start, match.end);
        if (range) (index === current ? active : others).push(range);
      });
      highlights.set('pr-find', new Highlight(...others)); highlights.set('pr-find-current', new Highlight(...active));
    };
    const schedule = () => { frame ||= requestAnimationFrame(paint); };
    // Rows arrive a frame or two after a scroll, so repaint briefly after each one too.
    let timer = 0;
    const onScroll = () => { schedule(); clearTimeout(timer); timer = window.setTimeout(schedule, 120); };
    paint(); const settle = window.setInterval(schedule, 250);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); clearTimeout(timer); clearInterval(settle); highlights.delete('pr-find'); highlights.delete('pr-find-current'); };
  }, [matches, current]);
}

// Steps through a file until the match's row is drawn, then centers it below the sticky bars.
export function scrollToMatch(match: FindMatch, offset: number) {
  let frames = 0, started = false;
  const step = () => {
    const row = rowFor(match);
    if (row) { const box = row.getBoundingClientRect(); scrollPageBy(box.top + box.height / 2 - (window.innerHeight + offset) / 2); return; }
    if (++frames > 160) return;
    const card = document.getElementById(fileAnchor(match.path));
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

export function FindBar({ query, onQuery, count, current, onStep, includeCollapsed, onIncludeCollapsed, onClose, focusKey }: { query: string; onQuery: (query: string) => void; count: number; current: number; onStep: (direction: 1 | -1) => void; includeCollapsed: boolean; onIncludeCollapsed: (value: boolean) => void; onClose: () => void; focusKey: number }) {
  const input = useRef<HTMLInputElement>(null);
  // Pressing ⌘F again re-focuses and selects the query.
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusKey]);
  return <div className="find-bar" role="search">
    <InputGroup className="h-8 bg-card">
      <InputGroupInput ref={input} value={query} onChange={event => onQuery(event.target.value)} placeholder="Find in diff" aria-label="Find in diff" spellCheck={false}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onStep(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') { event.preventDefault(); onClose(); } }} />
      <InputGroupAddon align="inline-end" className="find-count">{query ? (count ? `${current + 1} of ${count}` : 'No results') : ''}</InputGroupAddon>
    </InputGroup>
    <Tip content="Search collapsed files" side="bottom"><Toggle size="sm" pressed={includeCollapsed} onPressedChange={onIncludeCollapsed} aria-label="Search collapsed files"><FoldVertical /></Toggle></Tip>
    <Tip content="Previous match" hotkey="⇧↵" side="bottom"><Button variant="ghost" size="icon-sm" aria-label="Previous match" disabled={!count} onClick={() => onStep(-1)}><ChevronUp /></Button></Tip>
    <Tip content="Next match" hotkey="↵" side="bottom"><Button variant="ghost" size="icon-sm" aria-label="Next match" disabled={!count} onClick={() => onStep(1)}><ChevronDown /></Button></Tip>
    <Tip content="Close" hotkey="Esc" side="bottom"><Button variant="ghost" size="icon-sm" aria-label="Close find" onClick={onClose}><X /></Button></Tip>
  </div>;
}
