import { useState } from 'react';
import { readStored, writeStored } from './browser-state';

export type CommentMode = 'inline' | 'indicators' | 'hidden';
export type DisplaySettings = { layout: 'unified' | 'split'; whitespace: 'show' | 'hide'; wrap: boolean; wordDiff: boolean; lineNumbers: boolean; fontSize: number; comments: CommentMode };
export const defaultDisplay: DisplaySettings = { layout: 'unified', whitespace: 'show', wrap: false, wordDiff: true, lineNumbers: true, fontSize: 12, comments: 'inline' };
export const fontSizes = { min: 9, max: 20 };
export const clampFontSize = (value: number) => Math.min(fontSizes.max, Math.max(fontSizes.min, Math.round(value * 2) / 2));
// Rows are about 1.67× the font size: 12px text on 20px rows.
export const lineHeightFor = (fontSize: number) => Math.round(fontSize * 5 / 3);
const displayKey = 'pr-guide:display';
function readDisplay(): DisplaySettings {
  const stored = readStored<Partial<DisplaySettings> & { size?: string }>(displayKey, {});
  // Earlier versions stored a size step instead of a font size.
  const legacy = ({ s: 11, m: 12, l: 13.5 } as Record<string, number>)[stored.size ?? ''];
  const { size: _size, ...rest } = stored;
  const merged = { ...defaultDisplay, ...rest, ...(legacy && stored.fontSize === undefined ? { fontSize: legacy } : {}) };
  return { ...merged, fontSize: clampFontSize(Number(merged.fontSize) || defaultDisplay.fontSize), comments: ['inline', 'indicators', 'hidden'].includes(merged.comments) ? merged.comments : 'inline' };
}
export function useDisplay(): [DisplaySettings, (patch: Partial<DisplaySettings>) => void, () => void] {
  const [display, setDisplay] = useState<DisplaySettings>(readDisplay);
  const update = (patch: Partial<DisplaySettings>) => setDisplay(previous => { const next = { ...previous, ...patch }; writeStored(displayKey, next); return next; });
  const reset = () => { writeStored(displayKey, defaultDisplay); setDisplay(defaultDisplay); };
  return [display, update, reset];
}

const MAX_PAIRS = 250_000;
// Turns removed/added line pairs that differ only in whitespace into context lines.
// Each pair becomes one context line, so hunk header counts stay valid.
export function hideWhitespace(patch: string): { patch: string; onlyWhitespace: boolean } {
  const out: string[] = [];
  let removed: string[] = [], added: string[] = [];
  const strip = (line: string) => line.slice(1).replace(/\s+/g, '');
  const flush = () => {
    if (removed.length && added.length && removed.length * added.length <= MAX_PAIRS) {
      const m = removed.length, n = added.length, a = removed.map(strip), b = added.map(strip);
      const table = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
      for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      let i = 0, j = 0;
      while (i < m && j < n) {
        if (a[i] === b[j]) { out.push(` ${added[j].slice(1)}`); i++; j++; }
        else if (table[i + 1][j] >= table[i][j + 1]) out.push(removed[i++]);
        else out.push(added[j++]);
      }
      while (i < m) out.push(removed[i++]);
      while (j < n) out.push(added[j++]);
    } else { out.push(...removed, ...added); }
    removed = []; added = [];
  };
  for (const line of patch.split('\n')) {
    if (line.startsWith('-')) { if (added.length) flush(); removed.push(line); }
    else if (line.startsWith('+')) added.push(line);
    else { flush(); out.push(line); }
  }
  flush();
  return { patch: out.join('\n'), onlyWhitespace: !out.some(line => line[0] === '+' || line[0] === '-') };
}
