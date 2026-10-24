import type { PullSort, PullSummary } from '../types';

export function groupPulls(items: PullSummary[], sort: PullSort, now: number) {
  if (sort === 'repo') {
    const groups = new Map<string, PullSummary[]>();
    for (const pull of items) {
      const group = groups.get(pull.repo) ?? [];
      group.push(pull); groups.set(pull.repo, group);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(([repo, items]) => ({ key: repo, title: repo, items }));
  }
  const today = new Date(now), start = (daysAgo: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo).getTime();
  const verb = sort === 'created' ? 'Created' : 'Updated';
  const groups: { key: string; title: string; since: number; items: PullSummary[] }[] = [
    { key: 'today', title: `${verb} today`, since: start(0), items: [] },
    { key: 'yesterday', title: `${verb} yesterday`, since: start(1), items: [] },
    { key: 'week', title: `${verb} in the last 7 days`, since: start(6), items: [] },
    { key: 'month', title: `${verb} in the last 30 days`, since: start(29), items: [] },
    { key: 'older', title: `${verb} earlier`, since: -Infinity, items: [] }
  ];
  for (const pull of items) {
    const timestamp = Date.parse(sort === 'created' ? pull.createdAt : pull.updatedAt);
    const group = groups.find(group => timestamp >= group.since) ?? groups[groups.length - 1];
    group.items.push(pull);
  }
  return groups.filter(group => group.items.length);
}
