import type { PullFilters, PullSort, PullSummary, PullTab, Settings } from './types.js';

export function pullSort(value: string | undefined): PullSort {
  return value === 'created' || value === 'repo' ? value : 'updated';
}

export function listFilters(filters: PullFilters, settings: Settings) {
  const tab: PullTab = filters.tab === 'review' || filters.tab === 'mine' || filters.tab === 'guides' ? filters.tab : 'all';
  return { tab, repo: filters.repo || '', author: filters.author || '', drafts: filters.drafts ? filters.drafts === 'shown' : settings.showDrafts, sort: pullSort(filters.sort) };
}

export function matchesList(pull: PullSummary, filters: ReturnType<typeof listFilters>, settings: Settings) {
  return pull.state === 'open' && settings.repos.includes(pull.repo)
    && (!filters.repo || pull.repo === filters.repo) && (!filters.author || pull.author === filters.author)
    && (filters.drafts || !pull.isDraft) && (settings.showBots || !pull.authorIsBot)
    && (filters.tab === 'all' || (filters.tab === 'review' && pull.reviewRequested) || (filters.tab === 'mine' && pull.mine) || (filters.tab === 'guides' && pull.guide !== null));
}

export function comparePulls(sort: PullSort, a: PullSummary, b: PullSummary) {
  const repo = a.repo.localeCompare(b.repo, undefined, { sensitivity: 'base' });
  return (sort === 'repo' ? repo : 0)
    || b[sort === 'created' ? 'createdAt' : 'updatedAt'].localeCompare(a[sort === 'created' ? 'createdAt' : 'updatedAt'])
    || repo || b.number - a.number;
}
