import { useEffect, useState } from 'react';
import { listPullIndex } from '../inbox.functions';
import type { IndexedPull, PullStack, PullSummary } from '../types';

// Pulls seen in lists, search and stacks, so the title can appear before the snapshot loads.
export type KnownPull = Pick<PullSummary, 'repo' | 'number' | 'title'> & Partial<PullSummary> & { stack?: PullStack | null };
const known = new Map<string, KnownPull>();
export const pullKey = (repo: string, number: number) => `${repo.toLowerCase()}#${number}`;
export function remember(pulls: KnownPull[]) { for (const pull of pulls) { const key = pullKey(pull.repo, pull.number); known.set(key, { ...known.get(key), ...pull }); } }
export function recall(repo: string, number: number) { return known.get(pullKey(repo, number)); }

let index: { at: number; request: Promise<IndexedPull[]> } | null = null;
export function pullIndex(): Promise<IndexedPull[]> {
  if (!index || Date.now() - index.at > 60_000) {
    const request = listPullIndex({ data: {} }).then(pulls => { remember(pulls); return pulls; });
    request.catch(() => { index = null; });
    index = { at: Date.now(), request };
  }
  return index.request;
}
// The home page's unfiltered first page is the same search the palette opens with, so it fills this cache.
export function seedIndex(pulls: IndexedPull[]) { const request = Promise.resolve(pulls.map(({ repo, number, title, author }) => ({ repo, number, title, author }))); index = { at: Date.now(), request }; }
export function forgetIndex() { index = null; }

// Small helpers for browser storage; reads and writes never throw.
export function readStored<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw) as T; } catch { return fallback; }
}
export function writeStored(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable; keep in memory */ } }
export const progressKey = (guideKey: string) => `pr-guide:progress:${guideKey}`;
export function readProgress(guideKey: string): string[] { const value = readStored<unknown>(progressKey(guideKey), []); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : []; }

export function useNow(interval = 60_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(timer); }, [interval]);
  return now;
}
export function ago(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'now';
  const units: [number, string][] = [[60, 'm'], [3600, 'h'], [86400, 'd'], [604800, 'w'], [2_592_000, 'mo'], [31_536_000, 'y']];
  let label = '';
  for (const [size, unit] of units) if (seconds >= size) label = `${Math.floor(seconds / size)}${unit}`;
  return label;
}
export function agoLong(iso: string, now: number): string {
  const short = ago(iso, now);
  if (short === 'now' || !short) return 'just now';
  const [, value, unit] = short.match(/^(\d+)(\w+)$/)!;
  const name = { m: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' }[unit]!;
  return `${value} ${name}${value === '1' ? '' : 's'} ago`;
}
