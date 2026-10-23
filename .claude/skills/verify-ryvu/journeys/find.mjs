import { pickLargePull } from './_pick.mjs';
// Find in diff: ⌘F searches patch text, counts matches, includes collapsed files on request, and highlights the current one.
export default async function (ctx) {
  const { page } = ctx;
  const { files, path } = await pickLargePull(ctx);
  // A word that really appears in a changed line, so the search has something to find.
  const term = files.flatMap(file => file.added).map(text => text.match(/[A-Za-z_]{7,}/)?.[0]).find(Boolean);
  ctx.check(Boolean(term), `chose search term "${term}" from an added line`);
  await ctx.go(`${path}/diff`);
  await ctx.waitForDiffRows();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  const input = page.getByLabel('Find in diff');
  await input.waitFor();
  ctx.check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Find in diff', '⌘F opens the find bar with the input focused');
  await input.fill(term); await page.waitForTimeout(800);
  const collapsedToggle = page.getByRole('button', { name: 'Search collapsed files' });
  if ((await collapsedToggle.getAttribute('aria-pressed')) !== 'true') await collapsedToggle.click();
  await page.waitForTimeout(400);
  const count = (await page.locator('.find-count').innerText()).trim();
  ctx.check(/^\d+ of \d+$/.test(count), `with collapsed files included the bar reports "${count}"`);

  await input.press('Enter'); await page.waitForTimeout(2500);
  const highlight = await page.evaluate(() => { const h = CSS.highlights?.get('pr-find-current'); const range = h && [...h][0]; return range ? { text: range.toString(), top: Math.round(range.getBoundingClientRect().top) } : null; });
  ctx.check(highlight && highlight.text.toLowerCase() === term.toLowerCase(), `Enter moves to a match and highlights "${highlight?.text}"`);
  ctx.check(highlight.top > 108 && highlight.top < 900, `the current match is on screen (${highlight.top}px)`);
  await ctx.shot('match');

  await input.press('Escape'); await page.waitForTimeout(300);
  ctx.check(await page.locator('.find-bar').count() === 0, 'Esc closes the find bar');
}
