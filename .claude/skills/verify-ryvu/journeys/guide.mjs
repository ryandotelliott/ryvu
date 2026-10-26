// Guide: a PR with a saved guide shows its sections, file chips jump to their diffs, and j moves to the next section.
// Needs a saved guide in the seeded database (launch copies yours by default); it never starts a new analysis.
export default async function (ctx) {
  const { page } = ctx;
  // VERIFY_GUIDE_PR=owner/repo/123 targets a PR known to have a saved guide; otherwise use the inbox's "Guide ready" tab.
  let target = process.env.VERIFY_GUIDE_PR ? `/pr/${process.env.VERIFY_GUIDE_PR.replace(/#/, '/')}` : null;
  if (!target) {
    await ctx.go('/?tab=guides');
    await page.waitForSelector('a.pull-row:not(.skeleton), .empty', { timeout: 60_000 });
    const rows = page.locator('a.pull-row:not(.skeleton)');
    if (!(await rows.count())) throw new Error('no PR in the "Guide ready" tab: the seeded database has no saved guide for an open PR at its current commit. Set VERIFY_GUIDE_PR=owner/repo/number to a PR that has one');
    ctx.check(true, `"Guide ready" lists ${await rows.count()} PRs`);
    target = (await rows.first().getAttribute('href')).replace(/\?.*$/, '').replace(/\/(diff|guide)$/, '');
  }
  await ctx.go(`${target}/guide`);
  // The loading skeleton also has a .chapter-section; the section rail only exists once the real guide renders.
  await page.waitForSelector('.section-rail button, .analyze-empty', { timeout: 60_000 });
  if (await page.locator('.analyze-empty').count()) throw new Error(`${target} has no saved guide at its current commit (the Guide page offers to analyze). Point VERIFY_GUIDE_PR at a PR with a saved guide`);
  const sections = await page.locator('.chapter-section').count();
  ctx.check(sections > 0, `the Guide shows ${sections} sections`);
  ctx.check(await page.locator('.section-rail button').count() === sections, 'the section rail has one tick per section');
  ctx.check(await page.getByText(/Scope and limitations/).count() === 0, 'the Guide has no Scope and limitations control or section');
  ctx.check(await page.getByText(/^Questions to consider/).count() === 0, 'the Guide has no Questions to consider sections');
  ctx.check(await page.getByText(/^(\d+ of \d+ sections left to review|All \d+ sections reviewed)$/).count() === 0, 'the Guide has no bottom review-progress panel');
  const fullWidth = await page.locator('.guide-page').evaluate(element => {
    const bounds = element.getBoundingClientRect(), css = getComputedStyle(element);
    const left = bounds.left + parseFloat(css.paddingLeft), right = bounds.right - parseFloat(css.paddingRight);
    return ['.guide-head', '.review-summary'].every(selector => {
      const child = element.querySelector(selector);
      if (!child) return selector === '.review-summary';
      const box = child.getBoundingClientRect();
      return Math.abs(box.left - left) < 1 && Math.abs(box.right - right) < 1;
    });
  });
  ctx.check(fullWidth, 'the Guide header and summary fill the content width');
  await ctx.shot('guide');

  const chip = page.locator('.chapter-section').first().locator('.chapter-file').first();
  const name = (await chip.locator('.filename').innerText()).trim();
  await chip.click(); await page.waitForTimeout(1500);
  const card = await page.evaluate(name => { const c = [...document.querySelectorAll('.chapter-section .diff-card')].find(card => card.querySelector('.filename')?.textContent === name); if (!c) return null; const b = c.getBoundingClientRect(); return { top: Math.round(b.top), expanded: c.classList.contains('expanded') }; }, name);
  ctx.check(card && card.expanded && card.top < 900, `clicking the "${name}" chip opens its diff on screen`);

  if (sections > 1) {
    await page.locator('.pr-topbar .topbar-title').click();
    await page.keyboard.press('j'); await page.waitForTimeout(1200);
    const tops = await page.evaluate(() => [...document.querySelectorAll('.chapter-section')].map(s => Math.round(s.getBoundingClientRect().top)));
    ctx.check(tops.some(top => Math.abs(top - 64) <= 2), `j brings a section to the top (section tops: ${tops.slice(0, 4).join(', ')})`);
  }
  await ctx.shot('after-jump');
  await page.locator('.chapter-section').first().locator('.chapter-reviewed [role="checkbox"]').click();
  await page.locator('.chapter-section.is-done').first().waitFor();
  ctx.check(await page.getByRole('button', { name: 'Next section', exact: true }).count() === 0, 'marking a section reviewed does not add a Next section button');
  await ctx.shot('reviewed-section');
}
