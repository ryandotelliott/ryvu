import { createServerFn } from '@tanstack/react-start';
import { fields, UserError } from './domain.js';
import { runtime } from './runtime.server';

const jobId = (value: unknown) => { if (typeof value !== 'string') throw new UserError('Job not found.', 404); return value; };

export const startAnalysis = createServerFn({ method: 'POST' })
  .validator((input: { clientId: string; sequence: number; url: string; fresh: boolean; ignored: string[] }) => fields(input))
  .handler(({ data }) => runtime().jobs.start(data.clientId, data.sequence, data.url, data.fresh ?? false, data.ignored ?? []));

export const getAnalysis = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => jobId(fields(input).id))
  .handler(({ data }) => runtime().jobs.get(data));

export const cancelAnalysis = createServerFn({ method: 'POST' })
  .validator((input: { id: string; clientId: string }) => { const raw = fields(input); return { id: jobId(raw.id), clientId: raw.clientId }; })
  .handler(({ data }) => runtime().jobs.cancel(data.id, data.clientId));
