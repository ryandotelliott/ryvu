import { pickLargePull } from './_pick.mjs';
// Diff page: the file sidebar lists every file, filters, jumps to a file, the header sticks, and Reviewed updates the count.
export default async function (ctx) {
  const { page } = ctx;
  const { files, path } = await pickLargePull(ctx);
  await ctx.go(`${path}/diff`);
  await ctx.waitForDiffRows();
  ctx.check(await ctx.visibleRows() > 0, 'the first open file draws code rows');
  const reviewed = page.locator('.diff-toolbar > .toolbar-progress');
  ctx.check(new RegExp(`^0/\\d+ reviewed$`).test((await reviewed.innerText()).trim()), `toolbar starts at "${(await reviewed.innerText()).trim()}"`);

  if (!(await page.locator('.file-tree').count())) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
  await page.waitForSelector('.file-tree');
  ctx.check(await page.locator('.file-tree').isVisible(), 'the sidebar shortcut opens the files sidebar');
  await page.getByRole('button', { name: 'File list display', exact: true }).click();
  await page.getByRole('button', { name: 'Diff order', exact: true }).click();
  await page.keyboard.press('Escape');
  if (await page.locator('.list-file').count()) ctx.check(await page.locator('.list-file').count() <= files.length && await page.locator('.list-file').count() > 0, `sidebar lists ${await page.locator('.list-file').count()} of ${files.length} files (hidden-file filters may remove some)`);
  await ctx.shot('sidebar');

  const target = files[Math.min(5, files.length - 1)], segment = target.path.split('/').slice(-1)[0].slice(0, 6);
  await page.getByRole('button', { name: 'Search files', exact: true }).click();
  await page.getByPlaceholder('Filter files').fill(segment);
  const filtered = await page.locator('.list-file').count();
  ctx.check(filtered > 0 && filtered <= files.length, `filtering by "${segment}" leaves ${filtered} rows`);
  await page.getByPlaceholder('Filter files').fill('');

  const row = page.locator('.list-file').filter({ hasText: target.path.split('/').pop() }).first();
  await row.click(); await page.waitForTimeout(1500);
  const top = await page.evaluate(path => { const card = [...document.querySelectorAll('.diff-card')].find(c => c.querySelector('.file-toggle')?.getAttribute('aria-label')?.endsWith(path)); return card ? Math.round(card.getBoundingClientRect().top) : null; }, target.path);
  ctx.check(top !== null && Math.abs(top - 108) <= 2, `clicking ${target.path} lands its card at ${top}px (expected 108, under the toolbar)`);
  await ctx.shot('jumped');

  await page.mouse.move(900, 500); await page.mouse.wheel(0, 400); await page.waitForTimeout(500);
  const stuck = await page.evaluate(() => { const card = [...document.querySelectorAll('.diff-card.expanded')].find(c => { const b = c.getBoundingClientRect(); return b.top < 100 && b.bottom > 200; }); return card ? Math.round(card.querySelector(':scope > .file-heading').getBoundingClientRect().top) : null; });
  if (stuck !== null) ctx.check(stuck === 108, `scrolling keeps the file header stuck at ${stuck}px`); else ctx.note('the target file was too short to scroll its header into the stuck position');

  await page.locator('.diff-card .file-reviewed [role="checkbox"]').first().click();
  await page.waitForTimeout(300);
  ctx.check(/^1\/\d+ reviewed$/.test((await reviewed.innerText()).trim()), `ticking Reviewed updates the toolbar to "${(await reviewed.innerText()).trim()}"`);
  await ctx.shot('reviewed');
}
