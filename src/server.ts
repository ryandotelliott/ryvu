import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, parsePR, parseRepo, UserError } from './domain.js';
import { fetchFile, replyToThread, submitReview, fetchConversation } from './github.js';
import { Store } from './store.js';
import { Jobs, ReviewService } from './service.js';
import { Inbox } from './pulls.js';
import { SettingsStore } from './settings.js';
import type { DiffSide, PRIdentity, ReviewEvent } from './types.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const MAX_BODY = 65_536;
// Set by `just dev`: pages come from the Vite dev server, so send browsers there instead of serving a stale build.
const devWeb = process.env.DEV_WEB_URL;
function pullFrom(repo: unknown, number: unknown): PRIdentity { return parsePR(`https://github.com/${parseRepo(repo)}/pull/${Number(number)}`); }
function lineNumber(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new UserError(`Invalid ${name}.`, 400); return Number(value); }
function text(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim() || value.length > MAX_BODY) throw new UserError(`Write a ${name} first.`, 400); return value; }
export function createApp(store = new Store(join(root, '.data/ryvu.db'))) {
  store.importFileCache(join(root, '.data/cache'));
  const service = new ReviewService(store), jobs = new Jobs(service), inbox = new Inbox(store), settings = new SettingsStore(join(root, '.data/settings.json'));
  const token = randomBytes(32).toString('hex');
  const json = (response: ServerResponse, status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
  return { jobs, store, server: createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host = request.headers.host ?? '', port = request.socket.localPort;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) throw new UserError('Invalid localhost Host header.', 403);
      const origin = `http://${host}`;
      if ((request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') throw new UserError('Only same-origin local requests are allowed.', 403);
      const url = new URL(request.url ?? '/', origin), path = url.pathname;
      if (path === '/api/bootstrap' && request.method === 'GET') return json(response, 200, { token, model: MODEL, limits: { files: 200, patchCharacters: 120000 } });
      if (path.startsWith('/api/')) {
        if (request.headers['x-review-token'] !== token) throw new UserError('Reload this page to reconnect to the local server.', 403);
        if (path === '/api/jobs' && request.method === 'POST') {
          const body = await readBody(request); return json(response, 202, jobs.start(body.clientId, body.sequence, body.url, body.fresh ?? false, body.ignored ?? []));
        }
        if (path === '/api/settings' && request.method === 'GET') return json(response, 200, settings.get());
        if (path === '/api/settings' && request.method === 'POST') return json(response, 200, settings.save(await readBody(request)));
        if (path === '/api/repos' && request.method === 'POST') {
          const repo = await inbox.validateRepo((await readBody(request)).repo), current = settings.get();
          if (current.repos.some(existing => existing.toLowerCase() === repo.toLowerCase())) throw new UserError(`${repo} is already on your list.`, 409);
          return json(response, 200, settings.save({ ...current, repos: [...current.repos, repo] }));
        }
        if (path === '/api/pulls' && request.method === 'GET') return json(response, 200, await inbox.page(settings.get(), url.searchParams));
        if (path === '/api/pulls/index' && request.method === 'GET') return json(response, 200, await inbox.index(settings.get(), url.searchParams.get('q') ?? ''));
        if (path === '/api/resolve' && request.method === 'GET') return json(response, 200, await inbox.resolve(settings.get(), url.searchParams.get('q') ?? ''));
        if (path === '/api/pull' && request.method === 'GET') return json(response, 200, await service.detail(pullFrom(url.searchParams.get('repo'), url.searchParams.get('number')), inbox.login(), new AbortController().signal));
        if (path === '/api/file' && request.method === 'GET') {
          const [owner, repo] = parseRepo(url.searchParams.get('repo')).split('/');
          return json(response, 200, { contents: await fetchFile(owner, repo, url.searchParams.get('sha') ?? '', url.searchParams.get('path') ?? '') });
        }
        if (path === '/api/conversation' && request.method === 'GET') return json(response, 200, await fetchConversation(pullFrom(url.searchParams.get('repo'), url.searchParams.get('number')), new AbortController().signal));
        if (path === '/api/drafts' && request.method === 'POST') {
          const body = await readBody(request), pull = pullFrom(body.repo, body.number), line = lineNumber(body.line, 'line');
          const startLine = body.startLine === null || body.startLine === undefined ? null : lineNumber(body.startLine, 'start line');
          if (typeof body.path !== 'string' || !body.path || body.path.length > 1000 || !['additions', 'deletions'].includes(body.side as string) || !/^[a-f0-9]{40}$/.test(String(body.headSHA)) || (startLine !== null && startLine > line)) throw new UserError('Invalid comment position.', 400);
          return json(response, 200, store.addDraft(`${pull.owner}/${pull.repo}`, pull.number, { headSHA: String(body.headSHA), path: body.path, side: body.side as DiffSide, startLine: startLine === line ? null : startLine, line, body: text(body.body, 'comment') }));
        }
        const draft = path.match(/^\/api\/drafts\/([a-f0-9-]{36})$/);
        if (draft && request.method === 'POST') return json(response, 200, store.updateDraft(draft[1], text((await readBody(request)).body, 'comment')));
        if (draft && request.method === 'DELETE') { store.deleteDraft(draft[1]); return json(response, 200, { ok: true }); }
        if (path === '/api/review' && request.method === 'POST') {
          const body = await readBody(request), pull = pullFrom(body.repo, body.number), repo = `${pull.owner}/${pull.repo}`;
          if (!/^[a-f0-9]{40}$/.test(String(body.headSHA)) || typeof body.body !== 'string') throw new UserError('Invalid review.', 400);
          const drafts = store.drafts(repo, pull.number);
          await submitReview(pull, String(body.headSHA), body.event as ReviewEvent, body.body, drafts);
          store.clearDrafts(repo, pull.number, drafts.map(item => item.id));
          return json(response, 200, { conversation: await fetchConversation(pull, new AbortController().signal), drafts: store.drafts(repo, pull.number) });
        }
        if (path === '/api/reply' && request.method === 'POST') {
          const body = await readBody(request), pull = pullFrom(body.repo, body.number);
          await replyToThread(pull, Number(body.commentId), text(body.body, 'reply'));
          return json(response, 200, await fetchConversation(pull, new AbortController().signal));
        }
        const match = path.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/cancel)?$/);
        if (match && !match[2] && request.method === 'GET') return json(response, 200, jobs.get(match[1]));
        if (match?.[2] && request.method === 'POST') { const body = await readBody(request); return json(response, 200, jobs.cancel(match[1], body.clientId)); }
        throw new UserError('Route not found.', 404);
      }
      if (devWeb && request.method === 'GET') { response.writeHead(302, { Location: `${devWeb}${path}${url.search}` }); return response.end(); }
      // Page routes such as /pr/owner/repo/1 are handled in the browser, so any path without a file extension gets the app.
      const asset = /^\/assets\/[A-Za-z0-9_.-]+$/.test(path) ? path.slice(1) : /\.[A-Za-z0-9]+$/.test(path) ? null : 'index.html';
      if (!asset || request.method !== 'GET') throw new UserError('Page not found.', 404);
      let bytes: Buffer; try { bytes = readFileSync(join(root, 'dist/public', asset)); } catch { throw new UserError('Page not found.', 404); }
      const type = asset.endsWith('.css') ? 'text/css' : asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.wasm') ? 'application/wasm' : asset.endsWith('.woff2') ? 'font/woff2' : 'text/html';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(bytes);
    } catch (error) { if (!response.headersSent) json(response, error instanceof UserError ? error.status : 500, { error: error instanceof UserError ? error.message : 'The local server could not complete this request.' }); else response.end(); }
  }) };
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new UserError('Expected JSON.', 415);
  let body = ''; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 262_144) throw new UserError('Request too large.', 413); }
  try { const parsed = JSON.parse(body); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; } catch { throw new UserError('Invalid JSON.', 400); }
}
if (process.argv[1] && dirname(fileURLToPath(import.meta.url)) === dirname(process.argv[1]) && process.argv[1].endsWith('server.js')) {
  const port = Number(process.env.PORT ?? 4317); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
  const { server, jobs, store } = createApp();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(devWeb ? `API on http://127.0.0.1:${port}; pages redirect to ${devWeb}` : `PR Guide → http://127.0.0.1:${port}\nAnalysis uses your existing gh and Codex sign-ins.`));
  const stop = () => { jobs.stop(); server.close(); server.closeAllConnections(); store.close(); }; process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
