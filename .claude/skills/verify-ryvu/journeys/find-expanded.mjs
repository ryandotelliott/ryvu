import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function (ctx) {
  const { page } = ctx;
  const target = process.env.VERIFY_FIND_PR;
  if (!target) throw new Error('Set VERIFY_FIND_PR=owner/repo/number to a PR with a changed line after a gap of at least 2000 unchanged lines.');
  const [owner, repo, number] = target.split('/');
  const files = ctx.github(`repos/${owner}/${repo}/pulls/${number}/files?per_page=100`);
  const candidates = files.flatMap(file => {
    let line = 0, previousEnd = 1, gap = 0;
    return (file.patch ?? '').split('\n').flatMap(text => {
      const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunk) { line = Number(hunk[1]); gap = line - previousEnd; previousEnd = line + Number(hunk[2] ?? 1); return []; }
      if (text.startsWith('-') || text.startsWith('\\')) return [];
      const number = line++;
      return gap >= 2000 && text.startsWith('+') && text.trim().length > 35 ? [{ path: file.filename, line: number, query: text.slice(1).trim(), gap }] : [];
    });
  });
  const match = candidates.find(candidate => !process.env.VERIFY_FIND_FILE || candidate.path === process.env.VERIFY_FIND_FILE);
  ctx.check(Boolean(match), 'GitHub provides a search match after at least 2000 unchanged lines');
  ctx.note(JSON.stringify(match));
  await ctx.go(`/pr/${target}/diff`);
  await ctx.waitForDiffRows();
  await page.getByRole('button', { name: 'File list display', exact: true }).click();
  await page.getByRole('button', { name: 'Diff order', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search files', exact: true }).click();
  const filter = page.getByPlaceholder('Filter files');
  await filter.fill(match.path);
  await page.locator('.list-file').first().click();
  await filter.press('Escape');
  const card = page.locator('.diff-card').filter({ has: page.locator(`.file-toggle[aria-label$=${JSON.stringify(` ${match.path}`)}]`) }).first();
  const gap = card.locator('[data-expand-all-button]').filter({ hasText: `All ${match.gap.toLocaleString()} lines` }).first();
  await gap.waitFor();
  ctx.check(true, 'the file exposes an expansion button for over 2000 unchanged lines');
  await gap.click();
  await page.waitForFunction(path => {
    const card = [...document.querySelectorAll('.diff-card')].find(card => card.querySelector('.file-toggle')?.getAttribute('aria-label') === `Collapse ${path}`);
    return card?.getBoundingClientRect().height > 30_000;
  }, match.path);
  ctx.check((await card.boundingBox()).height > 30_000, 'expanding unchanged context adds thousands of lines to the file');
  await ctx.shot('expanded-context');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  await page.evaluate(() => {
    window.findScrolls = [];
    const original = window.scrollBy.bind(window);
    window.scrollBy = (...args) => { window.findScrolls.push(args[1] ?? args[0]?.top ?? 0); return original(...args); };
  });
  await page.getByLabel('Find in diff').fill(match.query);
  const visible = await page.waitForFunction(query => {
    const range = [...(CSS.highlights?.get('pr-find-current') ?? [])][0];
    if (!range || range.toString().toLowerCase() !== query.toLowerCase()) return false;
    const box = range.getBoundingClientRect();
    return box.top > 108 && box.bottom < innerHeight;
  }, match.query, { timeout: 8000 }).then(() => true, () => false);
  const scrolls = await page.evaluate(() => window.findScrolls);
  writeFileSync(join(ctx.out, 'scrolls.json'), JSON.stringify({ match, visible, scrolls }, null, 2));
  ctx.note(`find used ${scrolls.length} programmatic scrolls; match visible: ${visible}`);
  await ctx.shot('search-result');
  ctx.check(visible && scrolls.length <= 6, 'find jumps directly to the expanded file match without walking down the file');
}
