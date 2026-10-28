import { randomUUID } from 'node:crypto';
import { fields, UserError } from './domain.js';
import { runCommand, type Runner } from './process.js';
import { isGithubScreenshot, MAX_SCREENSHOT_BYTES } from './screenshots.js';

function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
const token = (runner: Runner) => runner('gh', ['auth', 'token', '--hostname', 'github.com'], { signal: AbortSignal.timeout(15_000) }).then(value => value.trim());

// The same authenticated asset endpoint used by GitHub CLI's --attach flag.
export async function uploadScreenshot(repo: string, file: File, runner: Runner = runCommand): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer()), type = imageType(bytes);
  if (!type || type !== file.type) throw new UserError('Paste a PNG, JPEG, GIF or WebP screenshot.', 400);
  const metadata = fields(JSON.parse(await runner('gh', ['api', `repos/${repo}`], { signal: AbortSignal.timeout(15_000) })));
  if (!Number.isSafeInteger(metadata.id) || Number(metadata.id) < 1) throw new UserError('GitHub did not identify the repository.');
  if (fields(metadata.permissions).push !== true) throw new UserError('Uploading screenshots requires write access to this repository.', 403);
  const extension = type === 'image/jpeg' ? 'jpg' : type.slice(6);
  const url = new URL('https://uploads.github.com/user-attachments/assets');
  url.search = new URLSearchParams({ name: `screenshot-${randomUUID()}.${extension}`, content_type: type, repository_id: String(metadata.id) }).toString();
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000), body: new Uint8Array(bytes),
    headers: { Authorization: `Bearer ${await token(runner)}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/octet-stream' }
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 404) throw new UserError('GitHub refused the screenshot upload. Check your gh sign-in and write access to this repository.');
    if (response.status === 429) throw new UserError('GitHub is limiting screenshot uploads. Wait a moment and paste again.');
    throw new UserError(`GitHub could not upload the screenshot (${response.status}). Paste it again to retry.`);
  }
  const result = fields(await response.json());
  if (typeof result.url !== 'string' || !isGithubScreenshot(result.url)) throw new UserError('GitHub did not return a screenshot URL.');
  return result.url;
}

// Credentials go only to github.com. The redirected CDN request uses its signed
// URL without the token, including when a private screenshot needs gh sign-in.
export async function readScreenshot(url: string, runner: Runner = runCommand): Promise<string> {
  let current = url;
  let response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${await token(runner)}` } });
  for (let redirects = 0; response.status >= 300 && response.status < 400 && redirects < 3; redirects++) {
    const location = response.headers.get('location');
    if (!location) break;
    const target = new URL(location, current);
    const githubCDN = target.hostname.endsWith('.githubusercontent.com') || /^github-production-user-asset-[a-z0-9-]+\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(target.hostname);
    if (target.protocol !== 'https:' || target.port || !(target.hostname === 'github.com' || githubCDN)) throw new UserError('GitHub returned an unexpected image location.');
    await response.body?.cancel();
    current = target.href;
    response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  }
  if (!response.ok || !response.body) throw new UserError('This screenshot could not be loaded with your gh sign-in.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      size += next.value.length;
      if (size > MAX_SCREENSHOT_BYTES) throw new UserError('This screenshot is larger than 10 MB.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks), type = imageType(bytes);
  if (!type) throw new UserError('This attachment is not a supported screenshot.');
  return `data:${type};base64,${bytes.toString('base64')}`;
}
