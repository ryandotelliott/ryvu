import { pickPullWithOpenThread } from './_pick.mjs';
// Read-only: never submits a reply or review to GitHub.
export default async function (ctx) {
  const { page } = ctx;
  const { open, path } = await pickPullWithOpenThread(ctx);
  await ctx.go(`${path}/diff`);
  await ctx.waitForDiffRows();
  const target = open[0];
  await page.getByRole('button', { name: 'File list display', exact: true }).click();
  await page.getByRole('button', { name: 'Diff order', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search files', exact: true }).click();
  const filter = page.getByPlaceholder('Filter files');
  await filter.fill(target.path);
  await page.locator('.list-file').first().click();
  await filter.press('Escape');
  await page.waitForTimeout(600);
  const thread = page.locator('.comment-fold').filter({ has: page.locator(`a[href="${target.html_url}"]`) });
  for (let step = 0; step < 100; step++) {
    const box = await thread.first().boundingBox();
    if (box && box.height > 0 && box.y + box.height > 108 && box.y < 850) break;
    await page.mouse.move(900, 600); await page.mouse.wheel(0, 500); await page.waitForTimeout(100);
  }
  const box = await thread.first().boundingBox();
  ctx.check(box && box.y + box.height > 108 && box.y < 850, `the file draws GitHub's thread by ${target.user.login} at line ${target.line}`);
  ctx.check(await thread.getByText(target.user.login, { exact: true }).count() > 0, 'the inline thread identifies its GitHub author');
  await ctx.shot('inline-thread');

  const display = page.locator('.toolbar-actions [aria-label="Display settings"]');
  await display.click(); await page.getByRole('radio', { name: 'Indicators' }).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  ctx.check(await page.locator('.comment-indicator').count() > 0 && await page.locator('.comment-fold').count() === 0, 'Indicators mode replaces inline threads with markers');
  await ctx.shot('indicators');
  await display.click(); await page.getByRole('radio', { name: 'Hidden' }).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  ctx.check(await page.locator('.comment-indicator').count() === 0 && await page.locator('.comment-fold').count() === 0, 'Hidden mode removes comments from the code');
  await display.click(); await page.getByRole('radio', { name: 'Inline' }).click(); await page.keyboard.press('Escape');
}
