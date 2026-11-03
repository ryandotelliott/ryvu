import { pickLargePull } from './_pick.mjs';

export default async function (ctx) {
  const { page } = ctx;
  const view = process.env.VERIFY_COLLAPSE_VIEW ?? 'diff';
  if (!['diff', 'guide'].includes(view)) throw new Error('VERIFY_COLLAPSE_VIEW must be diff or guide');
  const path = process.env.VERIFY_COLLAPSE_PR ? `/pr/${process.env.VERIFY_COLLAPSE_PR}` : (await pickLargePull(ctx)).path;
  await ctx.go(`${path}/${view}`);
  await ctx.waitForDiffRows();
  const pinnedTop = await page.locator('.pr-page').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--sticky-top')));

  const index = await page.locator('.diff-card').evaluateAll(cards => cards.findIndex(card => {
    const box = card.getBoundingClientRect();
    return box.height > 1500 && box.bottom + scrollY < document.documentElement.scrollHeight - 1000;
  }));
  ctx.check(index >= 0, 'the PR has a long file with other files below it');
  const card = page.locator('.diff-card').nth(index);
  const toggle = card.locator('.file-toggle'), reviewed = card.locator('.file-reviewed [role=checkbox]');
  ctx.note(`testing ${await toggle.getAttribute('aria-label')}`);

  for (const position of ['pinned', 'in-flow']) for (const action of ['reviewed', 'toggle']) {
    await card.evaluate((element, top) => window.scrollBy(0, element.getBoundingClientRect().top - top), position === 'pinned' ? pinnedTop : 300);
    if (position === 'pinned') {
      await page.mouse.move(1200, 500);
      await page.mouse.wheel(0, 900);
    }
    await page.waitForTimeout(500);
    const before = await card.evaluate(element => ({ top: element.getBoundingClientRect().top, header: element.querySelector('.file-heading').getBoundingClientRect().top }));
    const expectedTop = position === 'pinned' ? pinnedTop : Math.round(before.header);
    ctx.check(position === 'pinned' ? before.top < -500 && Math.abs(before.header - pinnedTop) <= 2 : before.top > pinnedTop + 20 && Math.abs(before.top - before.header) <= 2, `${position}, ${action}: the file header starts at ${Math.round(before.header)}px`);
    ctx.check(await ctx.visibleRows() > 0, 'the expanded file draws code before collapsing');
    await ctx.shot(`${position}-${action}-before-collapse`);
    await (action === 'reviewed' ? reviewed : toggle).click();
    await page.waitForTimeout(600);
    ctx.check(!(await card.getAttribute('class')).split(' ').includes('expanded'), `${action}: the file collapses`);
    const top = await card.evaluate(element => Math.round(element.getBoundingClientRect().top));
    ctx.check(Math.abs(top - expectedTop) <= 2, `${position}, ${action}: collapsed file stays at ${top}px, expected ${expectedTop}px`);
    await ctx.shot(`${position}-${action}-after-collapse`);
    await (action === 'reviewed' ? reviewed : toggle).click();
    await card.locator('.diff-card-body').waitFor();
  }
}
