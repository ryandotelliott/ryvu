import { createCsrfMiddleware, createStart } from '@tanstack/react-start';
import { localSession } from './session';

export const startInstance = createStart(() => ({
  // Having this file turns off Start's default CSRF check, so it is installed here: server functions accept only same-origin calls.
  requestMiddleware: [createCsrfMiddleware({ filter: ctx => ctx.handlerType === 'serverFn' })],
  functionMiddleware: [localSession]
}));
