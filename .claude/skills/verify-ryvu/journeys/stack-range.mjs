// Picking a second PR in the stack menu opens every PR between the two as one diff. Set VERIFY_STACK_PR=owner/repo/number
// to a PR with at least two PRs above it in a GitHub stack.
export default async function (ctx) {
  const { page } = ctx;
  const [owner, repo, number] = (process.env.VERIFY_STACK_PR ?? 'ryvn-technologies/ryvn/9508').split('/');
  const stack = (await ctx.github(`repos/${owner}/${repo}/stacks?pull_request=${number}`))[0];
  const order = stack.pull_requests.map(pull => pull.number).reverse(), at = order.indexOf(Number(number));
  ctx.check(at >= 2, `#${number} has two PRs above it in its stack, top first: ${order.join(', ')}`);
  // The range, top first, from this PR up two.
  const range = order.slice(at - 2, at + 1), through = range[0], label = `#${range[2]} – #${range[0]}`;
  const pulls = await Promise.all(range.map(async n => (await ctx.github(`repos/${owner}/${repo}/pulls/${n}`))[0]));
  const touched = await Promise.all(range.map(async n => (await ctx.github(`repos/${owner}/${repo}/pulls/${n}/files?per_page=100`)).flatMap(file => [file.filename, file.previous_filename].filter(Boolean))));
  const compare = (await ctx.github(`repos/${owner}/${repo}/compare/${pulls[2].base.sha}...${pulls[0].head.sha}?per_page=100`))[0];
  const files = compare.files.map(file => file.filename);
  ctx.note(`Range ${label}: GitHub compares ${files.length} files from ${pulls[2].base.sha.slice(0, 7)} to ${pulls[0].head.sha.slice(0, 7)}.`);
  const base = `/pr/${owner}/${repo}/${number}`, rangePath = `${base}/diff?through=${through}`;
  const path = () => { const url = new URL(page.url()); return url.pathname + url.search; };
  const anchorId = file => `file-${encodeURIComponent(file).replace(/%/g, '_')}`;
  const trigger = page.locator('.pr-topbar .stack-trigger');
  const loaded = () => page.waitForSelector('.pr-page:not([aria-busy]) .view-tabs', { timeout: 120_000 });
  const openMenu = async () => {
    await trigger.click();
    await page.locator('.stack-menu .stack-row').first().waitFor();
    await page.locator('.stack-menu').evaluate(menu => Promise.all(menu.getAnimations().map(animation => animation.finished)));
  };
  const row = n => page.locator('.stack-menu .stack-line', { has: page.locator(`.stack-row[href^="/pr/${owner}/${repo}/${n}/"], .stack-row[href="/pr/${owner}/${repo}/${n}"]`) });

  // Picking the other end in the menu
  await ctx.go(`${base}/diff`);
  // The loading page can show the stack switcher too; the loaded page replaces it, closing a menu opened early.
  await loaded();
  await trigger.waitFor({ timeout: 60_000 });
  await openMenu();
  ctx.check(await page.locator('.stack-label span').first().innerText() === `${order.length} stacked` && (await page.locator('.stack-label').innerText()).includes(`Click a dot to review with #${number}`), 'the menu explains that a dot picks the other end');
  ctx.check(await row(number).locator('.stack-dot.is-anchor').count() === 1 && await page.locator('.stack-menu button.stack-dot').count() === order.length - 1, 'this PR’s dot marks one end, and every other PR has a dot to click');
  ctx.check(await page.locator('.stack-footer').count() === 0, 'nothing is picked when the menu opens');
  await row(through).locator('button.stack-dot').click();
  const marked = await page.locator('.stack-menu .stack-line.in-range .topbar-number').allInnerTexts();
  ctx.check(JSON.stringify(marked) === JSON.stringify(range.map(n => `#${n}`)), `the dot marks ${marked.join(', ')} as the range`);
  ctx.check(await page.locator('.stack-menu').isVisible(), 'the menu stays open after a dot is clicked');
  const footer = (await page.locator('.stack-footer').innerText()).replace(/\s+/g, ' ');
  const additions = pulls.reduce((sum, pull) => sum + pull.additions, 0).toLocaleString('en-US');
  ctx.check(footer.includes(label) && footer.includes('3 pull requests') && footer.includes(`+${additions}`), `the footer sums the range: “${footer}”`);
  await ctx.shot('range-picked');
  await row(through).locator('button.stack-dot').click();
  ctx.check(await page.locator('.stack-footer').count() === 0 && await page.locator('.stack-menu .stack-line.in-range').count() === 0, 'clicking the picked dot again clears the range');
  await row(through).locator('button.stack-dot').click();
  await page.locator('.stack-footer').getByRole('menuitem', { name: 'Review together' }).click();
  await page.waitForURL(url => new URL(url).pathname + new URL(url).search === rangePath);
  await loaded();

  // The combined diff
  await page.waitForSelector('.diff-card', { timeout: 60_000 });
  ctx.check((await trigger.innerText()).trim() === label, `the title names the range: “${(await trigger.innerText()).trim()}”`);
  ctx.check(!(await trigger.innerText()).includes('of') && await page.locator('.pr-topbar [aria-label*="Close"], .pr-topbar [aria-label*="Back to"]').count() === 0, 'the title has no position count and no close button');
  const disabled = page.locator('.view-tabs [aria-disabled="true"]');
  ctx.check(await disabled.innerText() === 'Guide' && await page.locator('.view-tabs a', { hasText: 'Guide' }).count() === 0, 'the Guide tab is disabled, not a link');
  await disabled.hover();
  await page.getByText('Guides cover one pull request at a time').waitFor({ timeout: 5_000 });
  ctx.check(true, 'hovering Guide explains why it is off');
  await ctx.shot('guide-disabled');
  await page.mouse.move(700, 600);
  const ids = await page.locator('.diff-card').evaluateAll(cards => cards.map(card => card.id));
  ctx.check(ids.length === files.length && files.every(file => ids.includes(anchorId(file))), `the diff shows GitHub’s ${files.length} compared files (${ids.length} cards)`);
  ctx.check(await page.locator('.diff-toolbar > .toolbar-progress').innerText() === `0/${files.length} reviewed`, 'the toolbar counts the combined files');
  await ctx.waitForDiffRows();
  ctx.check(await ctx.visibleRows() > 0, 'the first files draw their code');
  let attributed = 0;
  for (const file of files) {
    const expected = range.filter((_, i) => touched[i].includes(file) || touched[i].includes(compare.files.find(item => item.filename === file).previous_filename)).reverse().map(n => `#${n}`);
    const chips = await page.locator(`[id="${anchorId(file)}"] .file-pull`).allInnerTexts();
    if (JSON.stringify(chips) !== JSON.stringify(expected)) { ctx.check(false, `${file} names ${chips.join(' ') || 'no PR'}, expected ${expected.join(' ')}`); }
    attributed += chips.length > 0 ? 1 : 0;
  }
  ctx.check(true, `every file names the PRs in the range that changed it, bottom first (${attributed} of ${files.length} attributed)`);
  ctx.check(await page.locator('.topbar-actions button').count() === 0 && await page.locator('.comment-fold, .comment-indicator').count() === 0, 'the range has no Review menu and shows no comments');
  await ctx.shot('range-diff');

  await page.getByRole('button', { name: 'File list display' }).click();
  await page.getByRole('button', { name: 'Diff order', exact: true }).click();
  await page.keyboard.press('Escape');
  const tags = await page.locator('.list-file').evaluateAll(rows => rows.map(row => row.querySelector('.file-tags')?.textContent ?? null));
  ctx.check(tags.length === files.length && tags.every(tag => tag !== null) && tags.some(tag => tag.startsWith('#')), `the file list names PRs in place of line counts (${tags.slice(0, 4).join(' | ')} …)`);
  await ctx.shot('file-list-tags');

  // A chip opens that PR's diff at the file, where the file's reviewed state is the PR's own
  const card = page.locator('.diff-card', { has: page.locator('.file-pull') }).nth(1);
  const cardId = await card.getAttribute('id'), chip = card.locator('.file-pull').last(), chipNumber = (await chip.innerText()).slice(1);
  await card.scrollIntoViewIfNeeded();
  await card.locator('.file-reviewed [role="checkbox"]').click();
  ctx.check(await page.locator('.diff-toolbar > .toolbar-progress').innerText() === `1/${files.length} reviewed`, 'ticking Reviewed counts toward the range');
  await chip.click();
  await page.waitForURL(url => new URL(url).pathname === `/pr/${owner}/${repo}/${chipNumber}/diff` && new URL(url).hash === `#${cardId}`);
  await loaded();
  await page.waitForFunction(id => { const card = document.getElementById(id), box = card?.getBoundingClientRect(); return card?.classList.contains('expanded') && box && box.top >= 0 && box.top < 200; }, cardId, { timeout: 30_000 });
  ctx.check(true, `the chip opened #${chipNumber}’s diff with ${cardId} expanded at the top`);
  ctx.check((await trigger.innerText()).includes(`#${chipNumber}`) && !(await trigger.innerText()).includes('–'), `#${chipNumber} shows as a single PR`);
  ctx.check(await page.locator(`[id="${cardId}"] .file-reviewed [role="checkbox"]`).getAttribute('aria-checked') !== 'true', 'the file reviewed in the range is not reviewed in the single PR');
  await ctx.shot('chip-opened-pull');
  await page.goBack();
  await page.waitForURL(url => new URL(url).pathname + new URL(url).search === rangePath);
  await loaded();
  await page.waitForSelector('.diff-card');
  ctx.check(await page.locator('.diff-toolbar > .toolbar-progress').innerText() === `1/${files.length} reviewed`, 'back on the range, its reviewed file is still counted');

  // Keys and the Overview
  await page.locator('.diff-panel').click({ position: { x: 4, y: 4 } }).catch(() => {});
  await page.keyboard.press('2');
  await page.waitForTimeout(400);
  ctx.check(path() === rangePath, 'key 2 does nothing on a range');
  await page.keyboard.press('1');
  await page.waitForURL(url => new URL(url).pathname + new URL(url).search === `${base}?through=${through}`);
  await page.waitForSelector('.range-pull');
  const listed = await page.locator('.range-pull h2 .topbar-number').allInnerTexts();
  ctx.check(JSON.stringify(listed) === JSON.stringify([...range].reverse().map(n => `#${n}`)), `key 1 opens the Overview, which lists ${listed.join(', ')} bottom first`);
  ctx.check(await page.locator('.range-pull .description').count() === 3, 'each PR shows its description');
  await ctx.shot('range-overview');

  // Links into a range
  await ctx.go(`${base}/guide?through=${through}`);
  await page.waitForURL(url => new URL(url).pathname + new URL(url).search === rangePath);
  ctx.check(true, 'a Guide link with a range lands on the range’s Diff');
  await loaded();
  await openMenu();
  ctx.check(await page.locator('.stack-menu .stack-row[aria-current="page"]').count() === 0 && await page.locator('.stack-menu .stack-line.in-range').count() === 3, 'on a range the menu marks the range and no single PR as current');
  await row(range[1]).locator('.stack-row').click({ modifiers: ['Shift'] });
  await page.waitForURL(url => new URL(url).pathname + new URL(url).search === `${base}/diff?through=${range[1]}`);
  await loaded();
  ctx.check((await trigger.innerText()).trim() === `#${range[2]} – #${range[1]}`, `shift-clicking #${range[1]} opens #${range[2]} – #${range[1]} directly`);
  await ctx.shot('shift-click-range');
  await openMenu();
  await row(number).locator('.stack-row').click();
  await page.waitForURL(url => new URL(url).pathname + new URL(url).search === `${base}/diff`);
  await loaded();
  ctx.check((await trigger.innerText()).includes(`#${number}`) && await page.locator('.view-tabs a', { hasText: 'Guide' }).count() === 1, `clicking #${number} in the menu returns to the single PR with its Guide tab`);
}
