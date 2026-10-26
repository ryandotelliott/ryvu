export default async function (ctx) {
  const { page } = ctx;
  const target = process.env.VERIFY_GUIDE_PR;
  if (!target) throw new Error('Set VERIFY_GUIDE_PR=owner/repo/number to a PR with a saved guide and at least two files.');
  await ctx.go(`/pr/${target.replace('#', '/')}/guide`);
  await page.locator('.section-rail button').first().waitFor({ timeout: 60_000 });
  const state = () => page.locator('.diff-card').evaluateAll(cards => cards.map(card => ({
    path: card.querySelector('.file-toggle').getAttribute('aria-label').replace(/^(Collapse|Expand) /, ''),
    open: card.classList.contains('expanded'),
    viewed: card.querySelector('.file-reviewed [role=checkbox]').getAttribute('aria-checked') === 'true',
  })));
  const card = path => page.locator('.diff-card').filter({ has: page.locator(`.file-toggle[aria-label$=${JSON.stringify(` ${path}`)}]`) }).first();
  const isOpen = async path => (await card(path).getAttribute('class')).split(' ').includes('expanded');
  const isViewed = async path => await card(path).locator('.file-reviewed [role=checkbox]').getAttribute('aria-checked') === 'true';
  const view = async name => {
    await page.getByRole('navigation', { name: 'View', exact: true }).getByRole('link', { name, exact: true }).click();
    await page.locator(`.pr-page.view-${name.toLowerCase()}`).waitFor();
  };
  const bulk = async action => {
    await page.getByRole('button', { name: 'Display settings', exact: true }).click();
    await page.getByRole('button', { name: action, exact: true }).click();
    await page.keyboard.press('Escape');
  };
  const expanded = rows => rows.filter(row => row.open).map(row => row.path).sort();
  const initialGuide = await state();
  ctx.check(initialGuide.length > 1 && initialGuide.every(row => row.open && !row.viewed), `all ${initialGuide.length} unviewed Guide code blocks start expanded`);
  await ctx.waitForDiffRows();
  ctx.check(await ctx.visibleRows() > 0, 'the expanded Guide draws code');
  await ctx.shot('guide-default');
  await view('Diff');
  const initialDiff = await state();
  const shared = initialDiff.filter(row => row.open && initialGuide.some(guide => guide.path === row.path));
  ctx.check(shared.length >= 2, 'two initially open Diff files also appear in the Guide');
  const [first, second] = shared.map(row => row.path);
  await view('Guide');
  await card(first).locator('.file-toggle').click();
  await view('Diff');
  ctx.check(JSON.stringify(expanded(await state())) === JSON.stringify(expanded(initialDiff)), 'collapsing a Guide file leaves Diff expansion unchanged');
  await card(second).locator('.file-toggle').click();
  await view('Guide');
  ctx.check(!(await isOpen(first)) && await isOpen(second), 'collapsing a Diff file leaves Guide expansion unchanged');

  await view('Diff');
  await card(second).locator('.file-toggle').click();
  await view('Guide');
  await card(second).locator('.file-reviewed [role=checkbox]').click();
  ctx.check(!(await isOpen(second)) && await isViewed(second), 'marking a Guide file viewed collapses that Guide block');
  await view('Diff');
  ctx.check(await isOpen(second) && await isViewed(second), 'the viewed checkbox is shared, while Diff stays expanded');
  await view('Guide');
  await card(first).locator('.file-toggle').click();
  await view('Diff');
  await card(first).locator('.file-reviewed [role=checkbox]').click();
  ctx.check(!(await isOpen(first)) && await isViewed(first), 'marking a Diff file viewed collapses that Diff block');
  await view('Guide');
  ctx.check(await isOpen(first) && await isViewed(first), 'Guide keeps its expansion when the file is viewed in Diff');
  await ctx.shot('independent-expansion');

  await page.reload();
  await page.locator('.section-rail button').first().waitFor({ timeout: 60_000 });
  const reloaded = await state();
  ctx.check(reloaded.every(row => row.open !== row.viewed), 'after reload, viewed Guide blocks start collapsed and unviewed blocks start expanded');
  ctx.check(await isViewed(first) && await isViewed(second), 'viewed state survives reload');
  await ctx.shot('viewed-persisted');
  await view('Diff');
  const diffBeforeBulk = expanded(await state());
  await view('Guide');
  await bulk('Collapse');
  ctx.check((await state()).every(row => !row.open), 'Collapse closes all Guide blocks');
  await view('Diff');
  ctx.check(JSON.stringify(expanded(await state())) === JSON.stringify(diffBeforeBulk), 'Guide Collapse leaves Diff expansion unchanged');
  await bulk('Expand');
  ctx.check((await state()).every(row => row.open), 'Expand opens all Diff files');
  await view('Guide');
  ctx.check((await state()).every(row => !row.open), 'Diff Expand leaves Guide expansion unchanged');
}
