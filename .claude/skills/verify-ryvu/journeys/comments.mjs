import { pickPullWithOpenThread } from './_pick.mjs';
// Comments: open threads show in the code, the Comments list (C) jumps to one, and the display modes switch how they appear.
// Read-only: never clicks Reply, Add to review or Submit review, which write to GitHub.
export default async function (ctx) {
  const { page } = ctx;
  const { open, path } = await pickPullWithOpenThread(ctx);
  await ctx.go(`${path}/diff`);
  await ctx.waitForDiffRows();

  await page.locator('body').click({ position: { x: 700, y: 600 } });
  await page.keyboard.press('c');
  await page.waitForSelector('.comments-menu');
  const items = page.locator('.comments-menu-item:visible');
  ctx.check(await items.count() >= open.length, `C opens the Comments list with ${await items.count()} entries (${open.length} open threads)`);
  const cornersClipped = await page.locator('.comments-menu').evaluate(async popup => {
    await Promise.all(popup.getAnimations({ subtree: true }).map(animation => animation.finished));
    const box = popup.getBoundingClientRect();
    return [[box.left + 1, box.top + 1], [box.right - 1, box.top + 1], [box.left + 1, box.bottom - 1], [box.right - 1, box.bottom - 1]]
      .every(([x, y]) => !popup.contains(document.elementFromPoint(x, y)));
  });
  ctx.check(cornersClipped, 'the Comments list content stays inside all four rounded corners');
  await ctx.shot('comments-list');
  await items.first().click(); await page.waitForTimeout(2500);
  const focused = await page.evaluate(() => { const el = document.querySelector('.comment-fold.is-focused'); return el ? Math.round(el.getBoundingClientRect().top) : null; });
  ctx.check(focused !== null && focused > 100 && focused < 900, `picking the first entry centres its thread in the diff (${focused}px)`);
  await ctx.shot('jumped-to-thread');

  const display = page.locator('.toolbar-actions [aria-label="Display settings"]');
  await display.click(); await page.getByRole('radio', { name: 'Indicators' }).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  ctx.check(await page.locator('.comment-indicator').count() > 0 && await page.locator('.comment-fold').count() === 0, 'Indicators mode replaces inline threads with markers');
  await ctx.shot('indicators');
  await display.click(); await page.getByRole('radio', { name: 'Hidden' }).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  ctx.check(await page.locator('.comment-indicator').count() === 0 && await page.locator('.comment-fold').count() === 0, 'Hidden mode removes comments from the code');
  await display.click(); await page.getByRole('radio', { name: 'Inline' }).click(); await page.keyboard.press('Escape');
}
