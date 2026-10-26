import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export default async function (ctx) {
  const { page, instance } = ctx;
  if (!instance.stubDir) throw new Error('launch the instance with VERIFY_STUB_CODEX=1, so no real Codex can run');
  if (!process.env.VERIFY_GUIDE_PR) throw new Error('set VERIFY_GUIDE_PR=owner/repo/number to a PR with a saved guide');
  const signal = process.env.VERIFY_SIGNAL ?? (instance.mode === 'dev' ? 'SIGINT' : 'SIGTERM');
  if (!['SIGINT', 'SIGTERM', 'SIGHUP'].includes(signal)) throw new Error('VERIFY_SIGNAL must be SIGINT, SIGTERM or SIGHUP');
  const target = `/pr/${process.env.VERIFY_GUIDE_PR}`, record = name => join(instance.stubDir, name);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const terms = () => existsSync(record('codex.log')) ? readFileSync(record('codex.log'), 'utf8').split('\n').filter(Boolean).length : 0;
  const stub = async () => {
    for (let i = 0; i < 300 && !existsSync(record('grandchild.pid')); i++) await page.waitForTimeout(100);
    if (!existsSync(record('grandchild.pid'))) throw new Error('the stand-in Codex never started');
    return { pid: Number(readFileSync(record('codex.pid'), 'utf8')), grandchild: Number(readFileSync(record('grandchild.pid'), 'utf8')) };
  };
  for (const name of ['codex.pid', 'grandchild.pid', 'codex.log']) rmSync(record(name), { force: true });
  const until = async (condition, ms) => { const end = Date.now() + ms; while (!condition() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25)); return condition(); };

  await ctx.go(`${target}?analyze=1`);
  await page.waitForSelector('.section-rail button, .analyze-empty', { timeout: 60_000 });
  ctx.check(new URL(page.url()).pathname === `${target}/guide` && !new URL(page.url()).search, `?analyze=1 opens ${target}/guide and drops the flag`);
  ctx.check(await page.locator('.section-rail button').count() > 0 && await page.getByRole('button', { name: 'Cancel' }).count() === 0, 'with a saved guide for this commit it starts no analysis');

  await page.getByRole('button', { name: 'Re-analyze' }).click();
  const first = await stub();
  ctx.check(alive(first.pid) && alive(first.grandchild), `Re-analyze reaches the stand-in Codex (pid ${first.pid}, grandchild ${first.grandchild})`);
  await ctx.shot('analyzing');
  await page.getByRole('button', { name: 'Cancel' }).click();
  ctx.check(await until(() => !alive(first.pid) && !alive(first.grandchild), 5000), 'Cancel ends the stand-in and its grandchild');
  ctx.check(terms() === 1, 'it ignored SIGTERM, so the SIGKILL that followed is what ended it');
  await page.getByText('Generation cancelled.').waitFor();
  await ctx.shot('cancelled');

  for (const name of ['codex.pid', 'grandchild.pid']) rmSync(record(name));
  await page.getByRole('button', { name: 'Re-analyze' }).click();
  const second = await stub();
  await page.locator('[data-slot=sidebar]').getByRole('link', { name: 'Pull requests', exact: true }).click();
  await page.waitForSelector('a.pull-row:not(.skeleton), .empty', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  ctx.check(alive(second.pid), 'the job keeps running after leaving the PR for the list');
  await page.goBack();
  await page.getByRole('button', { name: 'Cancel' }).waitFor();
  ctx.check(true, 'back on the PR, its Guide still shows the running job with Cancel');
  await ctx.shot('still-running');

  await page.goto('about:blank');
  ctx.check(existsSync(join(instance.dataDir, 'ryvu.db-wal')), 'while the server runs, its database has a write-ahead log');
  const sent = Date.now();
  process.kill(instance.pid, signal);
  let childGone = 0;
  const serverGone = await until(() => { if (!childGone && !alive(second.pid) && !alive(second.grandchild)) childGone = Date.now(); return !alive(instance.pid); }, 15_000);
  const exited = Date.now();
  ctx.check(serverGone, `${signal} stops the server (${exited - sent}ms)`);
  ctx.check(childGone > 0, `the stand-in and its grandchild were gone before the server exited (${childGone ? `${childGone - sent}ms after ${signal}` : `pids ${[second.pid, second.grandchild].filter(alive).join(', ')} outlived it`})`);
  ctx.check(terms() === 2, 'the stand-in got SIGTERM first and needed the SIGKILL escalation again');
  ctx.check(!existsSync(join(instance.dataDir, 'ryvu.db-wal')), 'the database was closed cleanly: SQLite removed its write-ahead log');
}
