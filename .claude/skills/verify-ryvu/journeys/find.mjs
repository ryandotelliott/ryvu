import { pickLargePull } from './_pick.mjs';
export default async function (ctx) {
  const { page } = ctx;
  const currentHighlight = async term => (await page.waitForFunction(term => {
    const range = [...(CSS.highlights?.get('pr-find-current') ?? [])][0];
    if (!range || range.toString().toLowerCase() !== term.toLowerCase()) return false;
    const box = range.getBoundingClientRect();
    return box.top > 108 && box.bottom < innerHeight ? { text: range.toString(), top: Math.round(box.top) } : false;
  }, term)).jsonValue();
  await page.addInitScript(() => localStorage.setItem('pr-guide:find-collapsed', 'false'));
  const { files, path } = await pickLargePull(ctx);
  // A word that really appears in a changed line, so the search has something to find.
  const term = files.flatMap(file => file.added).map(text => text.match(/[A-Za-z_]{7,}/)?.[0]).find(Boolean);
  ctx.check(Boolean(term), `chose search term "${term}" from an added line`);
  await ctx.go(`${path}/diff`);
  await ctx.waitForDiffRows();
  await page.getByRole('button', { name: 'Display settings', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  ctx.check(await page.locator('.diff-card.expanded').count() === 0, 'all Diff files start collapsed for this search');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  const input = page.getByLabel('Find in diff');
  await input.waitFor();
  ctx.check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Find in diff', '⌘F opens the find bar with the input focused');
  ctx.check(await page.getByRole('button', { name: 'Search collapsed files' }).count() === 0, 'find has no collapsed-files toggle');
  await input.fill(term);
  await page.waitForFunction(() => /^\d+ of \d+$/.test(document.querySelector('.find-count')?.textContent.trim() ?? ''));
  const count = (await page.locator('.find-count').innerText()).trim();
  ctx.check(/^\d+ of \d+$/.test(count), `with collapsed files included the bar reports "${count}"`);

  await currentHighlight(term);
  await input.press('Enter');
  const highlight = await currentHighlight(term);
  ctx.check(highlight && highlight.text.toLowerCase() === term.toLowerCase(), `Enter moves to a match and highlights "${highlight?.text}"`);
  ctx.check(highlight.top > 108 && highlight.top < 900, `the current match is on screen (${highlight.top}px)`);
  ctx.check(await page.locator('.diff-card.expanded').count() > 0, 'jumping to a result opens its collapsed file automatically');
  await ctx.shot('match');

  await input.press('Escape'); await page.waitForTimeout(300);
  ctx.check(await page.locator('.find-bar').count() === 0, 'Esc closes the find bar');

  const target = process.env.VERIFY_GUIDE_PR;
  if (!target) { ctx.note('Guide positioning not checked; set VERIFY_GUIDE_PR to a PR with a saved guide.'); return; }
  await ctx.go(`/pr/${target.replace('#', '/')}/guide`);
  await ctx.waitForDiffRows();
  const guidePaths = await page.locator('.file-toggle').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label').replace(/^(Expand|Collapse) /, '')));
  const [owner, repo, number] = target.replace('#', '/').split('/');
  const guideFiles = ctx.github(`repos/${owner}/${repo}/pulls/${number}/files?per_page=100`).filter(file => guidePaths.includes(file.filename));
  const guideTerm = guideFiles.flatMap(file => (file.patch ?? '').split('\n').filter(line => /^[+ -]/.test(line) && !/^[+-]{3}/.test(line))).map(text => text.match(/[A-Za-z_]{7,}/)?.[0]).find(Boolean);
  ctx.check(Boolean(guideTerm), `chose Guide search term "${guideTerm}" from a file in its sections`);
  await page.getByRole('button', { name: 'Display settings', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  ctx.check(await page.locator('.diff-card.expanded').count() === 0, 'all Guide code blocks start collapsed for this search');
  const headingBefore = await page.locator('.pr-heading').boundingBox();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  ctx.check((await page.locator('.pr-heading').boundingBox()).y === headingBefore.y, 'opening Guide find adds no header row or content shift');
  await input.fill(guideTerm);
  await currentHighlight(guideTerm);
  ctx.check(await page.locator('.diff-card.expanded').count() > 0, 'Guide find also opens matching collapsed code blocks');
  for (const width of [1440, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    const header = await page.locator('.pr-topbar').boundingBox();
    const bar = await page.locator('.find-bar').boundingBox();
    const stickyTop = await page.locator('.pr-page').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--sticky-top')));
    ctx.check(bar.y === stickyTop && bar.y > header.y + header.height, `at ${width}px Guide find floats at the file-header level below navigation`);
    ctx.check(bar.x >= 0 && bar.x + bar.width <= width, `at ${width}px Guide find fits inside the viewport`);
    await page.locator('.diff-card.expanded').first().evaluate(el => scrollTo(0, scrollY + el.getBoundingClientRect().top - 64 + Math.min(80, el.getBoundingClientRect().height / 4)));
    await page.waitForFunction(() => {
      const bar = document.querySelector('.find-bar').getBoundingClientRect();
      return [...document.querySelectorAll('.diff-card.expanded .file-heading')].some(header => Math.abs(header.getBoundingClientRect().top - bar.top) < 1);
    });
    ctx.check((await page.locator('.find-bar').boundingBox()).y === stickyTop, `at ${width}px the search bar stays level with the sticky file header while scrolling`);
    await ctx.shot(`guide-find-${width}`);
  }
  await input.press('Escape');
  ctx.check(await page.locator('.find-bar').count() === 0, 'closing Guide find removes the floating bar');
}
