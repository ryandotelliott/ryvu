import { useEffect, useState } from 'react';
import { readStored, writeStored } from './browser-state';

// Glob patterns: `*` stays within a folder, `**` crosses folders, `?` is one character.
// A pattern without a slash matches the file name in any folder, as in .gitignore.
const compiled = new Map<string, RegExp>();
function toRegExp(pattern: string) {
  let regex = compiled.get(pattern);
  if (!regex) {
    const anchored = pattern.includes('/'), body = pattern.replace(/^\//, '').replace(/\/$/, '/**');
    const source = body.split(/(\*\*\/?|\*|\?)/).map(part => part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('');
    regex = new RegExp(`${anchored ? '^' : '(?:^|/)'}${source}$`);
    compiled.set(pattern, regex);
  }
  return regex;
}
export const matchesPattern = (pattern: string, path: string) => toRegExp(pattern).test(path);

export type HiddenFiles = { patterns: string[]; enabled: boolean; setPatterns: (patterns: string[]) => void; setEnabled: (enabled: boolean) => void };
// Hidden-file patterns, and whether they apply, are saved per repository.
const keyFor = (repo: string) => `pr-guide:hidden-files:${repo.toLowerCase()}`;
function readHiddenFiles(repo: string): { patterns: string[]; enabled: boolean } {
  const stored = readStored<unknown>(keyFor(repo), null);
  // Earlier versions stored only the pattern list.
  const value = Array.isArray(stored) ? { patterns: stored, enabled: stored.length > 0 } : stored && typeof stored === 'object' ? stored as { patterns?: unknown; enabled?: unknown } : {};
  return { patterns: Array.isArray(value.patterns) ? value.patterns.filter((item): item is string => typeof item === 'string') : [], enabled: value.enabled === true };
}
// The paths currently hidden for a repository, read from saved settings (for code outside the PR page's state).
export function hiddenPaths(repo: string, paths: string[]): string[] {
  const { patterns, enabled } = readHiddenFiles(repo);
  return enabled ? paths.filter(path => patterns.some(pattern => matchesPattern(pattern, path))) : [];
}
export function useHiddenFiles(repo: string): HiddenFiles {
  const key = keyFor(repo);
  const [state, setState] = useState(() => readHiddenFiles(repo));
  useEffect(() => { writeStored(key, state); }, [key, state]);
  return { ...state, setPatterns: patterns => setState(previous => ({ ...previous, patterns })), setEnabled: enabled => setState(previous => ({ ...previous, enabled })) };
}
