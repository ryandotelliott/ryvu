import { fileURLToPath } from 'node:url';

process.env.PR_GUIDE_DATA_DIR ??= fileURLToPath(new URL('../.data', import.meta.url));
const { default: entry, serve } = await import('../dist/server/server.js');
await serve({ fetch: entry.fetch, client: fileURLToPath(new URL('../dist/client', import.meta.url)), port: Number(process.env.PORT ?? 4317) });
