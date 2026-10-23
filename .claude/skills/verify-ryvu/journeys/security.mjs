import { request } from 'node:http';

export default async function (ctx) {
  const { page, instance } = ctx;
  const host = `127.0.0.1:${instance.port}`, origin = `http://${host}`;
  const send = (path, { method = 'GET', headers = {}, body, chunked = false } = {}) => new Promise((resolve, reject) => {
    let answered = false;
    const outgoing = request({ host: '127.0.0.1', port: instance.port, path, method, headers: { host, ...headers }, agent: false }, response => {
      answered = true;
      let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    outgoing.on('error', error => { if (!answered) reject(error); });
    if (!chunked) { if (body) outgoing.write(body); outgoing.end(); return; }
    const write = sent => { if (answered || sent >= body.length) return outgoing.end(); outgoing.write(body.subarray(sent, sent + 16_384)); setTimeout(() => write(sent + 16_384), 5); };
    write(0);
  });

  const calls = [];
  page.on('response', async response => {
    const call = response.request();
    if (response.status() === 200 && call.url().includes('/_serverFn/')) calls.push({ method: call.method(), path: new URL(call.url()).pathname + new URL(call.url()).search, headers: await call.allHeaders(), body: call.postData() });
  });
  await ctx.go('/');
  await page.waitForSelector('a.pull-row:not(.skeleton), .empty', { timeout: 60_000 });
  const session = calls.find(call => call.method === 'POST'), list = calls.find(call => call.method === 'GET');
  ctx.check(session && list, `captured the page's successful session call and list read (${calls.length} server-function responses)`);
  ctx.note(`session ${session.path}; list ${list.path.slice(0, 60)}…`);

  for (const [label, headers] of [['a foreign Host', { host: `evil.example:${instance.port}` }], ['another port in Host', { host: '127.0.0.1:1' }], ['a foreign Origin', { origin: 'http://evil.example' }], ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }]]) {
    const page403 = await send('/pr/a/b/1/diff', { headers }), fn403 = await send(list.path, { headers: { ...list.headers, ...headers } });
    ctx.check(page403.status === 403 && fn403.status === 403, `${label} is refused for pages (${page403.status}) and server functions (${fn403.status})`);
  }
  const asset = instance.mode === 'dev' ? '/@vite/client' : (await send('/')).text.match(/\/assets\/[\w.-]+\.js/)[0];
  ctx.check((await send(asset, { headers: { host: `evil.example:${instance.port}` } })).status === 403, `assets are guarded too (${asset})`);

  const same = { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin', 'x-tsr-serverfn': 'true' };
  const replayed = await send(list.path, { headers: list.headers });
  ctx.check(replayed.status === 200, `the captured list read replays unchanged (${replayed.status})`);
  const noToken = { ...list.headers }; delete noToken['x-review-token'];
  const tokenless = await send(list.path, { headers: noToken });
  ctx.check(tokenless.text.includes('Reload this page to reconnect'), `without the session token the read fails with "Reload this page to reconnect" (${tokenless.status})`);
  const bare = await send(session.path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tsr-serverfn': 'true' }, body: session.body ?? undefined });
  ctx.check(bare.status === 403, `a session call with no Origin, Sec-Fetch-Site or Referer is refused by the CSRF check (${bare.status})`);

  const big = Buffer.alloc(262_145, 'a');
  const declared = await send(session.path, { method: 'POST', headers: { ...same, 'content-length': String(big.length) }, body: big });
  ctx.check(declared.status === 413, `a body declared over 262144 bytes is refused (${declared.status})`);
  const streamed = await send(session.path, { method: 'POST', headers: { ...same, 'transfer-encoding': 'chunked' }, body: big, chunked: true });
  ctx.check(streamed.status === 413, `a chunked body that grows past 262144 bytes is refused (${streamed.status})`);
  const form = await send(session.path, { method: 'POST', headers: { ...same, 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  ctx.check(form.status === 415, `a form-encoded body is refused (${form.status})`);

  if (instance.mode === 'prod') {
    const shell = await send('/settings'), policy = shell.headers['content-security-policy'] ?? '', scripts = policy.match(/script-src ([^;]+)/)?.[1] ?? '';
    ctx.check(shell.headers['x-content-type-options'] === 'nosniff' && shell.headers['referrer-policy'] === 'no-referrer' && shell.headers['cache-control'] === 'no-store', 'pages carry nosniff, no-referrer and no-store');
    ctx.check(/'sha256-[^']+'/.test(scripts) && !scripts.includes('unsafe-inline'), `script-src allows the page's inline scripts by hash only (${scripts})`);
    ctx.check(replayed.headers['cache-control'] === 'no-store', `server-function responses are no-store (${replayed.headers['cache-control']})`);
  }
  await ctx.shot('inbox-under-policy');
}
