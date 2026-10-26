import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickLargePull } from './_pick.mjs';

const PROBE = 'verify-ryvu reload probe';
const TARGETS = ['src/web/shell.tsx', 'src/inbox.functions.ts', 'src/pull.functions.ts', 'src/settings.ts'];
const CYCLES = 4;

export default async function (ctx) {
  const { page, instance } = ctx;
  if (instance.mode !== 'dev' || !instance.stubDir) throw new Error('launch with VERIFY_MODE=dev VERIFY_STUB_CODEX=1');
  if (!process.env.VERIFY_GUIDE_PR) throw new Error('set VERIFY_GUIDE_PR=owner/repo/number to a PR with a saved guide');
  const root = execFileSync('git', ['-C', dirname(fileURLToPath(import.meta.url)), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', ...TARGETS], { encoding: 'utf8' });
  if (dirty) throw new Error(`dev-reload rewrites ${TARGETS.join(', ')} and restores them afterwards, so it runs only while git shows them unchanged. Run it in a clean worktree. A run that was killed leaves "${PROBE}" in them.\n${dirty}`);

  const target = `/pr/${process.env.VERIFY_GUIDE_PR}`, record = name => join(instance.stubDir, name), wal = join(instance.dataDir, 'ryvu.db-wal');
  const originals = new Map();
  const edit = (file, change) => {
    const path = join(root, file), original = originals.get(path) ?? readFileSync(path, 'utf8'), changed = change(original);
    if (changed === original) throw new Error(`the probe edit no longer matches ${file}; update dev-reload`);
    originals.set(path, original);
    writeFileSync(path, changed);
  };
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const until = async (condition, ms) => { const end = Date.now() + ms; while (!condition() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25)); return condition(); };
  const terms = () => existsSync(record('codex.log')) ? readFileSync(record('codex.log'), 'utf8').split('\n').filter(Boolean).length : 0;
  const stubs = () => spawnSync('pgrep', ['-f', join(instance.stubDir, 'bin', 'codex')], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map(Number);
  const kept = () => page.evaluate(() => window.__verifyMarker === 'kept');
  const answered = async (sent, click) => (await Promise.all([page.waitForResponse(response => response.url().includes('/_serverFn/') && response.request().method() === 'POST' && sent(response.request().postData() ?? ''), { timeout: 30_000 }), click()]))[0].text();
  const analysisOf = path => JSON.stringify(path.replace(/^\/pr\/(.+)\/(\d+)$/, 'https://github.com/$1/pull/$2'));

  const consoleLog = [], consoleErrors = [], hotUpdates = [], tokens = [], responses = [];
  page.on('console', message => {
    consoleLog.push(`${new Date().toISOString()} [${message.type()}] ${message.text()}`);
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.text().startsWith('[vite] hot updated:')) hotUpdates.push(Date.now());
  });
  page.on('request', call => { const token = call.headers()['x-review-token']; if (call.url().includes('/_serverFn/') && token) tokens.push(token); });
  page.on('response', async response => {
    if (!response.url().includes('/_serverFn/')) return;
    const at = Date.now(), body = await response.text().catch(() => '');
    responses.push({ at, method: response.request().method(), body });
  });
  const noConsoleErrors = label => ctx.check(consoleErrors.length === 0, `${label}, with no console errors${consoleErrors.length ? `: ${consoleErrors.map(text => text.split('\n')[0]).join(' | ')}` : ''}`);

  const startJob = async () => {
    for (const name of ['codex.pid', 'grandchild.pid']) rmSync(record(name), { force: true });
    const reanalyze = page.getByRole('button', { name: 'Re-analyze' });
    await reanalyze.waitFor({ timeout: 60_000 });
    const id = (await answered(body => body.includes(analysisOf(target)), () => reanalyze.click())).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
    for (let i = 0; i < 300 && !existsSync(record('grandchild.pid')); i++) await page.waitForTimeout(100);
    if (!existsSync(record('grandchild.pid'))) throw new Error('the stand-in Codex never started');
    const job = { id, pid: Number(readFileSync(record('codex.pid'), 'utf8')), grandchild: Number(readFileSync(record('grandchild.pid'), 'utf8')) };
    ctx.check(id && alive(job.pid) && alive(job.grandchild), `Re-analyze started job ${id} with the stand-in Codex (pid ${job.pid}, grandchild ${job.grandchild})`);
    return job;
  };
  const polls = (job, since) => responses.filter(call => call.method === 'GET' && call.at > since && call.body.includes(job.id));
  const stillPolling = async (job, label) => {
    const since = Date.now();
    await until(() => polls(job, since).length >= 2, 6000);
    const seen = polls(job, since);
    ctx.check(seen.length >= 2 && seen.every(call => call.body.includes('generating')), `${label}: the page keeps polling job ${job.id} and it is still generating (${seen.length} polls in ${Date.now() - since} ms)`);
  };
  const showsJob = async (job, label) => {
    const cancel = page.getByRole('status').filter({ hasText: 'Organizing' }).getByRole('button', { name: 'Cancel' });
    await cancel.waitFor({ timeout: 10_000 });
    ctx.check(await cancel.isEnabled() && alive(job.pid) && alive(job.grandchild), `${label}: the Guide still shows the running job with an enabled Cancel, and its stand-in ${job.pid} is alive`);
  };
  const toList = async () => {
    await page.locator('[data-slot=sidebar]').getByRole('link', { name: 'Pull requests', exact: true }).click();
    await page.waitForSelector('a.pull-row:not(.skeleton)', { timeout: 60_000 });
  };
  const hotEdit = async (file, change, label) => {
    const since = Date.now();
    edit(file, change);
    await until(() => hotUpdates.some(at => at > since), 15_000);
    await page.waitForTimeout(1500);
    ctx.check(hotUpdates.some(at => at > since) && await kept(), `${label} reached the page as a hot update, without reloading it`);
  };
  const editListPulls = n => hotEdit('src/inbox.functions.ts', text => text.replace('return inbox.page(settings.get(), data); });', `return inbox.page(settings.get(), data).then(page => ({ ...page, items: page.items.map(item => ({ ...item, title: \`${PROBE} ${n}: \${item.title}\` })) })); });`), `function edit ${n}`);
  const editGetPull = () => hotEdit('src/pull.functions.ts', text => text.replace('return service.detail(data, inbox.login(), new AbortController().signal); });', `return service.detail(data, inbox.login(), new AbortController().signal).then(detail => ({ ...detail, snapshot: { ...detail.snapshot, title: \`${PROBE} getPull: \${detail.snapshot.title}\` } })); });`), 'the getPull edit');
  const drawn = (card, text) => page.evaluate(([card, text]) => [...document.getElementById(card)?.querySelector('diffs-container')?.shadowRoot?.querySelectorAll('[data-line][data-line-type="change-addition"]') ?? []].some(row => row.textContent === text && row.getClientRects().length > 0), [card, text]);
  const listShows = async n => {
    const lists = page.getByRole('navigation', { name: 'Pull request lists' });
    await lists.getByRole('link', { name: /^Authored by me/ }).click();
    await page.waitForURL(url => url.searchParams.get('tab') === 'mine');
    await lists.getByRole('link', { name: /^All open/ }).click();
    await page.locator('.pull-title', { hasText: `${PROBE} ${n}:` }).first().waitFor({ timeout: 30_000 });
    ctx.check(await kept(), `returning to All open shows titles that edit ${n} of listPulls returned`);
  };

  rmSync(record('codex.log'), { force: true });
  try {
    const other = (await ctx.inbox()).find(pull => pull.path !== target);
    ctx.check(other, `the inbox has a PR besides ${target} to analyze while the runtime closes`);
    await page.evaluate(() => { window.__verifyMarker = 'kept'; });
    edit('src/web/shell.tsx', text => text.replace('>Find a pull request</span>', '>Find a pull request (reloaded)</span>'));
    await page.locator('[data-slot="sidebar-menu-button"]', { hasText: 'Find a pull request (reloaded)' }).waitFor({ timeout: 30_000 });
    ctx.check(await kept(), 'a UI edit shows up in place, without reloading the page');
    await ctx.shot('ui-hot-reload');

    await ctx.go(`${target}/guide`);
    await page.evaluate(() => { window.__verifyMarker = 'kept'; });
    const first = await startJob();
    await showsJob(first, 'before any function edit');
    await stillPolling(first, 'before any function edit');
    await ctx.shot('job-running');
    await editListPulls(1);
    await showsJob(first, 'edit 1 made on the Guide');
    process.kill(-first.pid, 'SIGKILL');
    const failed = await page.getByRole('alert').filter({ hasText: 'codex exited unsuccessfully' }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
    ctx.check(failed && !alive(first.pid) && !alive(first.grandchild), 'when its stand-in exits on its own after edit 1, the Guide shows the failure it polled');
    await ctx.shot('failure-polled-after-edit');
    noConsoleErrors('edit 1 kept polling until the job ended');

    const second = await startJob();
    for (let n = 2; n <= CYCLES + 1; n++) {
      if (n % 2 === 1) {
        await editListPulls(n);
        await showsJob(second, `edit ${n} made on the Guide`);
        await stillPolling(second, `edit ${n} made on the Guide`);
        await toList();
      } else {
        await toList();
        await editListPulls(n);
        await stillPolling(second, `edit ${n} made on the list`);
      }
      await listShows(n);
      if (n === 2) await ctx.shot('function-edit');
      await page.goBack();
      await showsJob(second, `back on the Guide after edit ${n}`);
      await stillPolling(second, `back on the Guide after edit ${n}`);
      ctx.check(Number(readFileSync(record('codex.pid'), 'utf8')) === second.pid, `edit ${n} started no other analysis`);
      noConsoleErrors(`edit ${n} kept the job, its polling and the page`);
    }
    await ctx.shot('job-after-edits');
    const cancelled = await answered(body => body.includes(second.id), () => page.getByRole('status').getByRole('button', { name: 'Cancel' }).click());
    ctx.check(cancelled.includes(second.id) && cancelled.includes('cancelled'), `after ${CYCLES} more function edits, Cancel reached job ${second.id}: ${cancelled.slice(0, 160)}`);
    ctx.check(await until(() => !alive(second.pid) && !alive(second.grandchild), 5000), `and ended its stand-in ${second.pid} and grandchild ${second.grandchild}`);
    await page.getByText('Generation cancelled.').waitFor({ timeout: 10_000 });
    await ctx.shot('cancelled-after-edits');

    const { files, path: large } = await pickLargePull(ctx);
    await ctx.go(`${large}/diff`);
    await ctx.waitForDiffRows();
    await page.evaluate(() => { window.__verifyMarker = 'kept'; });
    const row = page.locator('.diff-card.expanded [data-line][data-line-type="change-addition"]').first();
    const line = await row.evaluate(element => ({ number: element.dataset.line, text: element.textContent, card: element.getRootNode().host.closest('.diff-card').id }));
    ctx.check(files.some(file => file.added.includes(line.text)), `line ${line.number} of ${line.card} is drawn with text GitHub reports as added: ${JSON.stringify(line.text.slice(0, 80))}`);
    await row.hover();
    await page.locator(`[id="${line.card}"] [data-utility-button]`).click();
    const composer = page.locator('.thread.composer'), unsent = `${PROBE} unsent comment ${Date.now()}`;
    await composer.getByPlaceholder('Leave a comment').pressSequentially(unsent);
    const typed = await composer.getByPlaceholder('Leave a comment').elementHandle();
    ctx.check(await composer.locator('.composer-label').innerText() === `Comment on line ${line.number}` && await typed.evaluate(element => element.value) === unsent, `typed an unsent comment into the composer on line ${line.number}`);
    await ctx.shot('unsent-comment');
    for (const [label, change] of [[`function edit ${CYCLES + 2}`, () => editListPulls(CYCLES + 2)], ['the getPull edit', editGetPull]]) {
      await change();
      const now = await composer.getByPlaceholder('Leave a comment').evaluate((element, before) => ({ same: element === before, value: element.value }), typed, { timeout: 5000 }).catch(() => ({ same: false, value: null }));
      const shown = await drawn(line.card, line.text), rows = await ctx.visibleRows();
      ctx.check(now.same && now.value === unsent && shown && rows > 0, `after ${label}, the same composer element still holds the unsent comment, and line ${line.number} is still drawn (same element: ${now.same}, text: ${JSON.stringify(now.value)}, line drawn: ${shown}, rows on screen: ${rows})`);
    }
    await ctx.shot('unsent-comment-after-edits');
    await composer.getByRole('button', { name: 'Cancel' }).click();
    noConsoleErrors('the unsent comment survived edits to both function files');

    await ctx.go(`${target}/guide`);
    await page.locator('.pr-heading h1', { hasText: `${PROBE} getPull:` }).waitFor({ timeout: 30_000 });
    ctx.check(true, 'a later load of the Guide shows the title the edited getPull returns');

    const third = await startJob();
    ctx.check(new Set(tokens).size === 1, `every server-function call so far carried the same session token (${tokens.length} calls)`);
    const signalled = terms();
    await ctx.go(`${other.path}/guide`);
    const analyze = page.getByRole('button', { name: /^(Re-analyze|Analyze)$/ });
    await analyze.waitFor({ timeout: 60_000 });
    ctx.check(alive(third.pid) && existsSync(wal), `the job outlives leaving its page, and the database is open, while ${other.repo}#${other.number} is ready to analyze`);
    edit('src/settings.ts', text => `${text}\n// ${PROBE}\n`);
    ctx.check(await until(() => terms() > signalled, 10_000), 'editing a runtime class starts closing the runtime: the stand-in gets SIGTERM');
    const answer = await answered(body => body.includes(analysisOf(other.path)), () => analyze.click());
    ctx.check(alive(third.pid), 'that analysis request was answered while the closing runtime still waited for its job');
    ctx.check(answer.includes('The local server is restarting'), `the closing runtime refused the new analysis instead of starting it: ${answer.slice(0, 160)}`);
    await page.getByRole('alert').filter({ hasText: 'The local server is restarting' }).waitFor({ timeout: 10_000 });
    await ctx.shot('refused-while-closing');
    ctx.check(await until(() => !alive(third.pid) && !alive(third.grandchild), 10_000), 'the close stopped the running job, its stand-in and the grandchild');
    ctx.check(await until(() => !existsSync(wal), 10_000), 'then it closed the database: SQLite removed its write-ahead log');

    await analyze.click();
    await page.getByRole('alert').filter({ hasText: 'Reload this page to reconnect' }).waitFor({ timeout: 30_000 });
    ctx.check(true, 'after the close, the open page is asked to reload because the new runtime has a new session');
    await ctx.shot('asked-to-reload');
    await page.reload();
    await page.waitForSelector('.pr-page:not([aria-busy]) .pr-heading h1', { timeout: 60_000 });
    ctx.check(true, 'after a reload the PR loads from the new runtime');
    ctx.check(Number(readFileSync(record('codex.pid'), 'utf8')) === third.pid && stubs().length === 0, `no stand-in Codex started for the refused analysis, and none is running (${stubs().join(', ') || 'none'})`);
    noConsoleErrors('the whole journey ran');
  } finally {
    for (const [path, text] of originals) writeFileSync(path, text);
    writeFileSync(join(ctx.out, 'console.log'), `${consoleLog.join('\n')}\n`);
  }
  ctx.check([...originals].every(([path, text]) => readFileSync(path, 'utf8') === text), `the ${originals.size} edited files are back as they were`);
}
