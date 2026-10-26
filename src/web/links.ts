import { linkOptions } from '@tanstack/react-router';
import type { PullFilters } from '../types';

export type PullViewName = 'overview' | 'guide' | 'diff';
export const pullViews = [['overview', 'Overview'], ['guide', 'Guide'], ['diff', 'Diff']] as const;
const filterKeys = ['tab', 'repo', 'author', 'drafts', 'sort'] as const;

export function homeSearch(search: Partial<Record<string, unknown>>): PullFilters {
  const filters: PullFilters = {};
  for (const key of filterKeys) {
    const value = search[key];
    if ((typeof value === 'string' && value) || typeof value === 'number' || typeof value === 'boolean') filters[key] = String(value);
  }
  return filters;
}

export type PullTarget = { key: string; view: PullViewName; url: string; repo: string; number: number; analyze: boolean };
export function pullTarget({ owner, repo, number, view }: { owner: string; repo: string; number: string; view?: string }, analyze: boolean): PullTarget | null {
  if (!/^[1-9][0-9]{0,9}$/.test(number) || (view !== undefined && !['guide', 'diff', 'changes'].includes(view))) return null;
  const name = `${owner}/${repo}`;
  return { key: `${name.toLowerCase()}#${number}`, view: view === 'guide' ? 'guide' : view ? 'diff' : 'overview', url: `https://github.com/${name}/pull/${number}`, repo: name, number: Number(number), analyze };
}

const stay = { resetScroll: false, activeOptions: { exact: true } } as const;
export const homeLink = (filters: PullFilters = {}) => linkOptions({ to: '/', search: homeSearch(filters), ...stay });
export const settingsLink = linkOptions({ to: '/settings', ...stay });
export function pullLink(repo: string, number: number, view: PullViewName = 'overview', analyze = false) {
  const [owner, name] = repo.split('/');
  return linkOptions({ to: '/pr/$owner/$repo/$number/{-$view}', params: { owner, repo: name, number: String(number), view: view === 'overview' ? undefined : view }, search: analyze ? { analyze: 1 as const } : {}, ...stay, resetScroll: true });
}
