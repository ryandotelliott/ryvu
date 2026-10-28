import { MAX_SCREENSHOT_BYTES } from './screenshots.js';

export const MAX_REQUEST_BYTES = 262_144;

export function refusal({ host, origin, fetchSite, port }: { host?: string; origin?: string; fetchSite?: string; port: number }): string | null {
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 'Invalid localhost Host header.';
  if ((origin && origin !== `http://${host}`) || fetchSite === 'cross-site') return 'Only same-origin local requests are allowed.';
  return null;
}

const refuse = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function withinLimit(request: Request): Promise<Request | Response> {
  if (!request.body) return request;
  const type = request.headers.get('content-type') ?? '', multipart = type.startsWith('multipart/form-data;');
  const limit = multipart ? MAX_SCREENSHOT_BYTES + 65_536 : MAX_REQUEST_BYTES;
  if (Number(request.headers.get('content-length')) > limit) return refuse(413, 'Request too large.');
  const chunks: Uint8Array[] = [], reader = request.body.getReader();
  let size = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength;
    if (size > limit) { void reader.cancel(); return refuse(413, 'Request too large.'); }
    chunks.push(next.value);
  }
  if (size && !type.startsWith('application/json') && !multipart) return refuse(415, 'Expected JSON or a screenshot upload.');
  return new Request(request.url, { method: request.method, headers: request.headers, signal: request.signal, body: size ? Buffer.concat(chunks) : null });
}
