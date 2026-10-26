export default async function (ctx) {
  const { page } = ctx;
  page.setDefaultTimeout(15_000);
  const target = process.env.VERIFY_GUIDE_PR;
  if (!target) throw new Error('Set VERIFY_GUIDE_PR to a PR with a saved Guide.');
  const base = `/pr/${target.replace('#', '/')}`;
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.addInitScript(() => localStorage.setItem('pr-guide:file-order', JSON.stringify('diff')));
  const position = () => page.evaluate(() => Math.round(scrollY));
  async function checkPosition(label, expected) {
    await page.waitForTimeout(300);
    const actual = await position();
    ctx.check(Math.abs(actual - expected) < 3, `${label} restores its own scroll position: expected ${expected}px, got ${actual}px`);
  }
  async function switchView(label, expected) {
    await page.locator('.view-tabs a', { hasText: label }).click();
    await page.waitForSelector(`.pr-page.view-${label.toLowerCase()}:not([aria-busy])`);
    await checkPosition(label, expected);
  }
  async function scrollDown(amount) {
    await page.mouse.move(1300, 400);
    await page.mouse.wheel(0, amount);
    await page.waitForTimeout(300);
    const actual = await position();
    ctx.check(actual > 300, `the page scrolled to ${actual}px`);
    return actual;
  }

  await ctx.go(`${base}/diff`);
  await ctx.waitForDiffRows();
  const diff = await scrollDown(1400);
  await ctx.shot('scrolled-diff');
  await switchView('Overview', 0);
  await ctx.shot('overview-starts-at-top');
  await switchView('Diff', diff);
  await switchView('Guide', 0);
  await ctx.waitForDiffRows();
  const guide = await scrollDown(800);
  await switchView('Diff', diff);
  await switchView('Guide', guide);
  await switchView('Overview', 0);
  await ctx.shot('overview-still-at-top');
  await page.mouse.move(1300, 400);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  const overview = await position();
  ctx.check(overview > 0, `Overview has its own nonzero position (${overview}px)`);
  await switchView('Guide', guide);
  await page.keyboard.press('3');
  await page.waitForSelector('.view-diff');
  await checkPosition('Diff via keyboard', diff);
  await page.goBack();
  await page.waitForSelector('.view-guide');
  await checkPosition('Guide via Back', guide);
  await page.goForward();
  await page.waitForSelector('.view-diff');
  await checkPosition('Diff via Forward', diff);
  await switchView('Overview', overview);

  const file = page.locator('.list-file').nth(1);
  const filename = await file.locator('.filename').innerText();
  ctx.note(`jumping from Overview to ${filename}`);
  await file.click();
  await page.waitForSelector('.view-diff');
  const card = page.locator('.diff-card').filter({ has: page.locator('.filename', { hasText: filename }) }).last();
  await card.locator('[data-line]').first().waitFor();
  await page.waitForTimeout(600);
  const box = await card.boundingBox();
  ctx.check(box.y >= 105 && box.y <= 110, `picking ${filename} from Overview jumps to that file instead of the saved Diff position (${Math.round(box.y)}px)`);
  ctx.check(await ctx.visibleRows() > 0, 'the jumped-to diff draws code');
  await ctx.shot('file-jump-from-overview');
}
