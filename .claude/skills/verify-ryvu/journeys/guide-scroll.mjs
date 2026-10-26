export default async function (ctx) {
  const { page } = ctx;
  const target = process.env.VERIFY_GUIDE_PR;
  if (!target) throw new Error('Set VERIFY_GUIDE_PR to a PR with a saved guide.');
  await ctx.go(`/pr/${target.replace('#', '/')}/guide`);
  await page.locator('.section-rail button').first().waitFor({ timeout: 60_000 });
  await ctx.waitForDiffRows();
  const explanation = page.locator('.explanation').first();
  async function wheelAtEdge({ height, edge, delta }) {
    await page.setViewportSize({ width: 1440, height });
    await page.locator('.chapter-section').first().evaluate(el => scrollTo(0, scrollY + el.getBoundingClientRect().top + 100));
    await explanation.evaluate((el, edge) => { el.scrollTop = edge === 'bottom' ? el.scrollHeight : 0; }, edge);
    await page.waitForTimeout(250);
    const before = await explanation.evaluate(el => ({ page: scrollY, inner: el.scrollTop, range: el.scrollHeight - el.clientHeight }));
    if (height === 520) ctx.check(before.range > 0, 'the short viewport makes the explanation scroll internally');
    const box = await explanation.boundingBox();
    await page.mouse.move(box.x + box.width / 2, Math.max(80, box.y) + Math.min(100, box.height / 2));
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(250);
    const after = await explanation.evaluate(el => ({ page: scrollY, inner: el.scrollTop }));
    ctx.note(`${height}px, ${edge}: page ${before.page} -> ${after.page}, explanation ${before.inner} -> ${after.inner}, scroll range ${before.range}`);
    ctx.check((after.page - before.page) * Math.sign(delta) > 50, `at ${height}px, scrolling ${delta > 0 ? 'down' : 'up'} over the explanation's ${edge} continues onto the page`);
    await ctx.shot(`explanation-${height}-${edge}`);
  }
  await wheelAtEdge({ height: 900, edge: 'bottom', delta: 300 });
  await wheelAtEdge({ height: 520, edge: 'bottom', delta: 300 });
  await wheelAtEdge({ height: 520, edge: 'top', delta: -200 });
}
