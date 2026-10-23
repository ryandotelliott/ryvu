import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { UserError } from './domain.js';
import { Inbox } from './pulls.js';
import { Jobs, ReviewService } from './service.js';
import { SettingsStore } from './settings.js';
import { Store } from './store.js';

export type Runtime = { token: string; store: Store; service: ReviewService; jobs: Jobs; inbox: Inbox; settings: SettingsStore; closing?: Promise<void>; close: () => Promise<void> };
// Kept on globalThis so development reloads of the modules that call it reuse the open database and running jobs.
declare global { var ryvuRuntime: Runtime | undefined; }

export function runtime(): Runtime {
  const current = globalThis.ryvuRuntime ??= open();
  if (current.closing) throw new UserError('The local server is restarting. Reload this page in a moment.', 503);
  return current;
}

function open(): Runtime {
  if (!process.env.PR_GUIDE_DATA_DIR) throw new Error('PR_GUIDE_DATA_DIR is not set.');
  const data = resolve(process.env.PR_GUIDE_DATA_DIR);
  const store = new Store(join(data, 'ryvu.db'));
  store.importFileCache(join(data, 'cache'));
  const service = new ReviewService(store), jobs = new Jobs(service);
  const current: Runtime = {
    token: randomBytes(32).toString('hex'), store, service, jobs, inbox: new Inbox(store), settings: new SettingsStore(join(data, 'settings.json')),
    close: () => current.closing ??= jobs.close().finally(() => {
      store.close();
      if (globalThis.ryvuRuntime === current) globalThis.ryvuRuntime = undefined;
    })
  };
  return current;
}
