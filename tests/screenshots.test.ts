import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readScreenshot, uploadScreenshot } from '../src/screenshots.server.js';
import { isGithubScreenshot, MAX_SCREENSHOT_BYTES } from '../src/screenshots.js';
import { withinLimit } from '../src/request-policy.js';
import type { Runner } from '../src/process.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
const asset = 'https://github.com/user-attachments/assets/11111111-2222-4333-8444-555555555555';
const runner: Runner = async (_command, args) => args[0] === 'auth' ? 'test-token' : JSON.stringify({ id: 123, permissions: { push: true } });

test('upload sends image bytes to the GitHub attachment endpoint and returns its URL', async t => {
  t.mock.method(globalThis, 'fetch', async (input: URL, options: RequestInit) => {
    assert.equal(input.origin, 'https://uploads.github.com');
    assert.equal(input.pathname, '/user-attachments/assets');
    assert.equal(input.searchParams.get('repository_id'), '123');
    assert.equal(input.searchParams.get('content_type'), 'image/png');
    assert.equal(options.headers && new Headers(options.headers).get('Authorization'), 'Bearer test-token');
    assert.deepEqual(Buffer.from(await new Response(options.body).arrayBuffer()), png);
    assert.equal(options.redirect, 'error');
    return Response.json({ url: asset });
  });
  assert.equal(await uploadScreenshot('owner/repo', new File([png], 'paste.png', { type: 'image/png' }), runner), asset);
});

test('upload rejects disguised files and repositories without write access', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not upload'); });
  await assert.rejects(uploadScreenshot('owner/repo', new File(['not a PNG'], 'x.png', { type: 'image/png' }), runner), /PNG, JPEG/);
  const readOnly: Runner = async () => JSON.stringify({ id: 123, permissions: { push: false } });
  await assert.rejects(uploadScreenshot('owner/repo', new File([png], 'x.png', { type: 'image/png' }), readOnly), /write access/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('private image reads authenticate GitHub and omit credentials from the CDN redirect', async t => {
  let calls = 0;
  let cdn = 'https://private-user-images.githubusercontent.com/123/screenshot.png?jwt=signed';
  t.mock.method(globalThis, 'fetch', async (input: string | URL, options: RequestInit) => {
    calls++;
    if (calls === 1) {
      assert.equal(String(input), asset);
      assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-token');
      return new Response(null, { status: 302, headers: { Location: cdn } });
    }
    assert.equal(new Headers(options.headers).get('Authorization'), null);
    return new Response(png);
  });
  assert.equal(await readScreenshot(asset, runner), `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(calls, 2);
  calls = 0; cdn = 'https://github-production-user-asset-6210df.s3.amazonaws.com/123/screenshot.png?signature=signed';
  assert.equal(await readScreenshot(asset, runner), `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(calls, 2);
});

test('private image reads reject unexpected redirects and oversized content', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { Location: 'https://example.com/steal' } }));
  await assert.rejects(readScreenshot(asset, runner), /unexpected image location/);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => new Response(Buffer.alloc(MAX_SCREENSHOT_BYTES + 1)));
  await assert.rejects(readScreenshot(asset, runner), /larger than 10 MB/);
});

test('only exact GitHub attachment URLs can use authenticated reads', () => {
  assert.equal(isGithubScreenshot(asset), true);
  for (const url of ['http://github.com/user-attachments/assets/11111111-2222-4333-8444-555555555555', asset.replace('github.com', 'github.com.evil.test'), asset.replace('github.com', 'github.com:444'), 'https://github.com/owner/repo', 'javascript:alert(1)']) assert.equal(isGithubScreenshot(url), false);
});

test('multipart images can exceed the JSON limit while normal request limits stay enforced', async () => {
  const data = new FormData(); data.set('repo', 'owner/repo'); data.set('file', new File([Buffer.alloc(300_000)], 'screenshot.png', { type: 'image/png' }));
  const request = new Request('http://localhost/_serverFn/upload', { method: 'POST', body: data });
  const checked = await withinLimit(request);
  assert.ok(checked instanceof Request);
  const file = (await checked.formData()).get('file');
  assert.ok(file instanceof File);
  assert.equal(file.size, 300_000);
  const json = await withinLimit(new Request('http://localhost/_serverFn/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'a'.repeat(262_145) }));
  assert.ok(json instanceof Response);
  assert.equal(json.status, 413);
});
