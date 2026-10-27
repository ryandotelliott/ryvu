import { createServerFn } from '@tanstack/react-start';
import { compareCommits } from './adapters.js';
import { fields, parseRepo, UserError } from './domain.js';
import { fetchBranches, fetchTree } from './github.js';
import type { BranchChanges } from './types.js';

// Reads for the Files view, which browses a repository at any branch. All read-only.
const repoFrom = (raw: Record<string, unknown>) => { const [owner, repo] = parseRepo(raw.repo).split('/'); return { owner, repo }; };
const isSHA = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export const listBranches = createServerFn({ method: 'GET' })
  .validator((input: { repo: string; query?: string }) => {
    const raw = fields(input), query = typeof raw.query === 'string' ? raw.query.trim() : '';
    if (query.length > 255) throw new UserError('That branch name is too long.', 400);
    return { ...repoFrom(raw), query };
  })
  .handler(({ data }) => fetchBranches(data.owner, data.repo, data.query));

// `ref` is a commit SHA or a branch name.
export const readTree = createServerFn({ method: 'GET' })
  .validator((input: { repo: string; ref: string }) => { const raw = fields(input); return { ...repoFrom(raw), ref: typeof raw.ref === 'string' ? raw.ref : '' }; })
  .handler(({ data }) => fetchTree(data.owner, data.repo, data.ref));

export const compareBranch = createServerFn({ method: 'GET' })
  .validator((input: { repo: string; base: string; head: string }) => {
    const raw = fields(input);
    if (!isSHA(raw.base) || !isSHA(raw.head)) throw new UserError('Invalid commits to compare.', 400);
    return { ...repoFrom(raw), base: raw.base, head: raw.head };
  })
  .handler(async ({ data }): Promise<BranchChanges> => {
    const { files } = await compareCommits(data.owner, data.repo, data.base, data.head, new AbortController().signal);
    return { files, truncated: files.length >= 300 };
  });
