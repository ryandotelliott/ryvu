import { createServerFn } from '@tanstack/react-start';
import { fields, UserError } from './domain.js';
import { pullQuery } from './pulls.js';
import { runtime } from './runtime.server';
import { validateSettings } from './settings.js';
import type { PullQuery, Settings } from './types.js';

const query = (value: unknown) => {
  if (value === undefined || typeof value === 'string') return value ?? '';
  throw new UserError('Invalid search.', 400);
};

export const openSession = createServerFn({ method: 'POST' })
  .handler(() => { const { token, settings } = runtime(); return { token, settings: settings.get() }; });

export const saveSettings = createServerFn({ method: 'POST' })
  .validator((input: Settings) => validateSettings(input))
  .handler(({ data }) => runtime().settings.save(data));

export const addRepository = createServerFn({ method: 'POST' })
  .validator((input: { repo: string }) => fields(input).repo)
  .handler(async ({ data }) => {
    const { inbox, settings } = runtime(), repo = await inbox.validateRepo(data), current = settings.get();
    if (current.repos.some(existing => existing.toLowerCase() === repo.toLowerCase())) throw new UserError(`${repo} is already on your list.`, 409);
    return settings.save({ ...current, repos: [...current.repos, repo] });
  });

export const listPulls = createServerFn({ method: 'GET' })
  .validator((input: PullQuery) => pullQuery(input))
  .handler(({ data }) => { const { inbox, settings } = runtime(); return inbox.page(settings.get(), data); });

export const listPullIndex = createServerFn({ method: 'GET' })
  .validator((input: { q?: string }) => query(fields(input).q))
  .handler(({ data }) => { const { inbox, settings } = runtime(); return inbox.index(settings.get(), data); });

export const resolvePull = createServerFn({ method: 'GET' })
  .validator((input: { q: string }) => query(fields(input).q))
  .handler(({ data }) => { const { inbox, settings } = runtime(); return inbox.resolve(settings.get(), data); });
