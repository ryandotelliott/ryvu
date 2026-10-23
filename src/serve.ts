import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { NodeRequest, sendNodeResponse } from 'srvx/node';
import { refusal } from './request-policy';

const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const scriptHashes = (html: string) => [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
const policy = (html: string) => `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${scriptHashes(html).join(' ')}; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;

export async function serve({ fetch, client, port }: { fetch: (request: Request) => Promise<Response>; client: string; port: number }): Promise<void> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
  const shell = await readFile(join(client, '_shell.html'));
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': policy(shell.toString()) };
  const server = createServer(async (request, response) => {
    const send = (status: number, type: string, body: string | Buffer) => { response.writeHead(status, { 'Content-Type': type }); response.end(body); };
    const header = (name: string) => { const value = request.headers[name]; return typeof value === 'string' ? value : undefined; };
    try {
      for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
      const reason = refusal({ host: header('host'), origin: header('origin'), fetchSite: header('sec-fetch-site'), port });
      if (reason) return send(403, 'application/json', JSON.stringify({ error: reason }));
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path.startsWith('/_serverFn/')) return await sendNodeResponse(response, await fetch(new NodeRequest({ req: request, res: response })));
      if (request.method === 'GET' && /^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) {
        const file = await readFile(join(client, path)).catch(() => null);
        return file ? send(200, types[extname(path)] ?? 'application/octet-stream', file) : send(404, 'application/json', JSON.stringify({ error: 'Page not found.' }));
      }
      if (request.method === 'GET' && !/\.[A-Za-z0-9]+$/.test(path)) return send(200, 'text/html', shell);
      send(404, 'application/json', JSON.stringify({ error: 'Page not found.' }));
    } catch {
      if (!response.headersSent) send(500, 'application/json', JSON.stringify({ error: 'The local server could not complete this request.' }));
      else response.end();
    }
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`PR Guide → http://127.0.0.1:${port}\nAnalysis uses your existing gh and Codex sign-ins.`));
  const stop = async () => { server.close(); server.closeAllConnections(); await globalThis.ryvuRuntime?.close(); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => void stop());
}
