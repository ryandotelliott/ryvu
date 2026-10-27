import { linkOptions } from '@tanstack/react-router';
import type { PullFilters } from '../types';

export type PullViewName = 'overview' | 'guide' | 'diff' | 'files';
export const pullViews = [['overview', 'Overview'], ['guide', 'Guide'], ['diff', 'Diff'], ['files', 'Files']] as const;
const filterKeys = ['tab', 'repo', 'author', 'drafts', 'sort'] as const;

export function homeSearch(search: Partial<Record<string, unknown>>): PullFilters {
  const filters: PullFilters = {};
  for (const key of filterKeys) {
    const value = search[key];
    if ((typeof value === 'string' && value) || typeof value === 'number' || typeof value === 'boolean') filters[key] = String(value);
  }
  return filters;
}

// `through` is set when the page reviews the PRs of one stack from `number` to `through` together.
// On Files, `branch` is the branch being browsed (the default branch when null) and `path` the open file.
export type FileSearch = { branch?: string; path?: string };
export type PullTarget = { key: string; view: PullViewName; url: string; repo: string; number: number; through: number | null; analyze: boolean; branch: string | null; path: string | null };
export function pullTarget({ owner, repo, number, view }: { owner: string; repo: string; number: string; view?: string }, search: { analyze?: 1; through?: number } & FileSearch): PullTarget | null {
  if (!/^[1-9][0-9]{0,9}$/.test(number) || (view !== undefined && !['guide', 'diff', 'changes', 'files'].includes(view))) return null;
  const name = `${owner}/${repo}`, through = search.through && search.through !== Number(number) ? search.through : null;
  return { key: `${name.toLowerCase()}#${number}${through ? `..${through}` : ''}`, view: view === 'guide' || view === 'files' ? view : view ? 'diff' : 'overview', url: `https://github.com/${name}/pull/${number}`, repo: name, number: Number(number), through, analyze: !through && search.analyze === 1, branch: search.branch ?? null, path: search.path ?? null };
}

const stay = { resetScroll: false, activeOptions: { exact: true } } as const;
export const homeLink = (filters: PullFilters = {}) => linkOptions({ to: '/', search: homeSearch(filters), ...stay });
export const settingsLink = linkOptions({ to: '/settings', ...stay });
export function pullLink(repo: string, number: number, view: PullViewName = 'overview', { analyze = false, through = null, branch = null, path = null }: { analyze?: boolean; through?: number | null; branch?: string | null; path?: string | null } = {}) {
  const [owner, name] = repo.split('/');
  const files = view === 'files' ? { ...(branch ? { branch } : {}), ...(path ? { path } : {}) } : {};
  return linkOptions({ to: '/pr/$owner/$repo/$number/{-$view}', params: { owner, repo: name, number: String(number), view: view === 'overview' ? undefined : view }, search: { ...(analyze ? { analyze: 1 as const } : {}), ...(through ? { through } : {}), ...files }, ...stay, resetScroll: true });
}
