import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pickLargePull } from './_pick.mjs';

export default async function (ctx) {
  const { page } = ctx;
  const { dataDir } = ctx.instance;
  const stored = () => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'));
  const drafts = text => { const db = new DatabaseSync(join(dataDir, 'ryvu.db'), { readOnly: true }); try { return db.prepare('SELECT count(*) AS n FROM drafts WHERE body = ?').get(text).n; } finally { db.close(); } };

  const before = stored().pageSize, next = before === 10 ? '50' : '10';
  await ctx.go('/settings');
  const perLoad = page.getByRole('group', { name: 'Pull requests per load' });
  await perLoad.getByRole('button', { name: next, exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  ctx.check(String(stored().pageSize) === next, `choosing ${next} per load writes pageSize ${stored().pageSize} to settings.json`);
  await page.reload();
  await perLoad.getByRole('button', { name: next, exact: true }).and(page.locator('[aria-pressed="true"]')).waitFor();
  ctx.check(true, `after a reload the Settings page still shows ${next} per load`);
  await ctx.shot('settings-saved');
  await perLoad.getByRole('button', { name: String(before), exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  ctx.check(stored().pageSize === before, `the original ${before} per load is restored`);

  const { path } = await pickLargePull(ctx);
  await ctx.go(`${path}/diff`);
  await ctx.waitForDiffRows();
  const text = `verify-ryvu pending comment ${Date.now()}`;
  const line = page.locator('.diff-card.expanded [data-line-type="change-addition"]').first();
  await line.hover();
  await page.locator('.diff-card.expanded [data-utility-button]').first().click();
  await page.getByPlaceholder('Leave a comment').fill(text);
  await page.getByRole('button', { name: 'Add to review' }).click();
  await page.locator('.thread', { hasText: text }).waitFor();
  ctx.check(drafts(text) === 1, 'Add to review stores one pending comment in the scratch database');
  await ctx.shot('draft-added');
  await page.reload();
  await ctx.waitForDiffRows();
  await page.locator('.thread', { hasText: text }).waitFor({ timeout: 30_000 });
  ctx.check(await page.locator('.thread', { hasText: text }).locator('.pending-chip').count() === 1, 'after a reload the pending comment is still on its line');
  await page.locator('.thread', { hasText: text }).getByRole('button', { name: 'Delete comment' }).click();
  await page.locator('.thread', { hasText: text }).waitFor({ state: 'detached' });
  ctx.check(drafts(text) === 0, 'Delete comment removes it from the database');
  await page.reload();
  await ctx.waitForDiffRows();
  ctx.check(await page.locator('.thread', { hasText: text }).count() === 0, 'after another reload it stays deleted');
}
