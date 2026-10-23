// Inbox: the home list loads real PRs, ⌘K finds one by title, and opening it shows that PR.
export default async function (ctx) {
  const { page } = ctx;
  await ctx.go('/');
  await page.waitForSelector('a.pull-row:not(.skeleton)', { timeout: 60_000 });
  const rows = page.locator('a.pull-row:not(.skeleton)');
  ctx.check(await rows.count() > 0, `the inbox lists pull requests (${await rows.count()})`);
  const title = (await rows.first().locator('.pull-title').innerText()).trim();
  await ctx.shot('inbox');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const search = page.getByPlaceholder('Search pull requests, or paste a link or number');
  await search.waitFor();
  const words = title.split(/\s+/).filter(word => word.length > 3).slice(0, 3).join(' ');
  await search.fill(words);
  await page.getByRole('option', { name: new RegExp(title.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().waitFor({ timeout: 15_000 });
  ctx.check(true, `⌘K search for "${words}" lists "${title}"`);
  await ctx.shot('palette');
  await page.keyboard.press('Escape');

  await rows.first().click();
  await page.waitForURL(/\/pr\/[^/]+\/[^/]+\/\d+/, { timeout: 15_000 });
  await page.waitForSelector('.pr-heading h1', { timeout: 60_000 });
  ctx.check((await page.locator('.pr-heading h1').innerText()).trim() === title, `opening the row shows that PR's Overview (${new URL(page.url()).pathname})`);
  ctx.check(await page.locator('.view-tabs a[aria-current="page"]').innerText() === 'Overview', 'the Overview tab is selected');
  await ctx.shot('overview');
}
