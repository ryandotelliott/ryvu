import { createMiddleware } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import { UserError } from './domain.js';
import { runtime } from './runtime.server';

let token = '';
export function setSessionToken(value: string) { token = value; }

export const localSession = createMiddleware({ type: 'function' })
  .client(({ next }) => next({ headers: { 'x-review-token': token } }))
  .server(async ({ next, serverFnMeta }) => {
    try {
      if (serverFnMeta.name !== 'openSession' && getRequestHeader('x-review-token') !== runtime().token) throw new UserError('Reload this page to reconnect to the local server.', 403);
      return await next();
    } catch (error) {
      throw new Error(error instanceof UserError ? error.message : 'The local server could not complete this request.');
    }
  });
