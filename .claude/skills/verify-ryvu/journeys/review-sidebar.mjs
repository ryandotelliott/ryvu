import { pickLargePull } from './_pick.mjs';

export default async function (ctx) {
  const { page } = ctx;
  const { path, files } = await pickLargePull(ctx);
  await ctx.go(`${path}/diff`);
  await ctx.waitForDiffRows();
  const sidebar = page.locator('[data-slot=sidebar-container], [data-slot=sidebar][data-mobile=true]');
  const bounds = await sidebar.boundingBox();
  ctx.check(bounds.y === 0 && bounds.height === page.viewportSize().height, 'the review sidebar fills the viewport from the top');
  ctx.check(await sidebar.getByRole('link', { name: 'Pull requests', exact: true }).isVisible() && await sidebar.getByRole('link', { name: 'Settings', exact: true }).isVisible(), 'the sidebar contains the regular app navigation');
  ctx.check(await sidebar.locator('.changed-file-tree').isVisible(), 'the files section starts in folder view');
  ctx.check(await sidebar.getByText('PR Guide', { exact: true }).count() === 0, 'the sidebar has no PR Guide brand row');
  const chain = sidebar.locator('[data-item-flattened-subitems]').first();
  await chain.waitFor();
  const segments = await chain.locator('[data-item-flattened-subitem]').evaluateAll(nodes => nodes.map(el => ({ path: el.getAttribute('data-item-flattened-subitem'), name: el.querySelector('[data-truncate-content=visible]').textContent, marker: Number(getComputedStyle(el.querySelector('[data-truncate-marker]')).opacity), width: el.getBoundingClientRect().width })));
  ctx.check(segments.length > 1 && files.some(file => file.path.startsWith(segments.at(-1).path)), 'nested folders share a compact path row');
  ctx.check(segments.slice(0, -1).every(segment => segment.marker === 0) && segments.at(-1).marker === 1, 'only the final folder name is truncated at the default width');
  const rail = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
  async function dragBy(delta) {
    const box = await rail.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 400);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + delta, box.y + 400, { steps: 12 }); await page.mouse.up();
    const width = Number(await rail.getAttribute('aria-valuenow'));
    await page.waitForFunction(width => Math.abs(document.querySelector('[data-slot=sidebar-container]').getBoundingClientRect().width - width) < 1 && Math.abs(document.querySelector('.pr-page').getBoundingClientRect().left - width) < 1, width);
    return width;
  }
  const expanded = await dragBy(120);
  ctx.check(expanded === bounds.width + 120, 'dragging the sidebar edge changes its width and the content inset together');
  ctx.check(await chain.locator('[data-item-flattened-subitem]').last().evaluate(el => el.getBoundingClientRect().width) > segments.at(-1).width, 'widening the sidebar gives the final folder name more room');
  await page.reload(); await ctx.waitForDiffRows();
  await page.waitForFunction(width => document.querySelector('[data-slot=sidebar-container]').getBoundingClientRect().width === width, expanded);
  ctx.check((await sidebar.boundingBox()).width === expanded, 'the resized sidebar width survives a reload');
  await rail.press('ArrowRight');
  await page.waitForFunction(width => document.querySelector('[data-slot=sidebar-container]').getBoundingClientRect().width === width, expanded + 16);
  ctx.check(Number(await rail.getAttribute('aria-valuenow')) === expanded + 16, 'the focused resize divider also accepts arrow keys');
  ctx.check(await dragBy(600) === 520 && await dragBy(-800) === 220, 'resizing respects its minimum and maximum widths');
  await rail.dblclick();
  await page.waitForFunction(() => document.querySelector('[data-slot=sidebar-container]').getBoundingClientRect().width === 256);
  ctx.check(true, 'double-clicking the divider restores its default width');
  ctx.check(await page.locator('.pr-topbar').getByRole('button', { name: /comments/i }).count() === 0, 'the separate comments menu is absent');
  const review = page.getByRole('button', { name: 'Review', exact: true });
  ctx.check(await review.locator('svg.lucide-chevron-down').count() === 1, 'Review has a downward expansion icon');
  await review.click();
  await page.getByRole('heading', { name: 'Finish your review' }).waitFor();
  ctx.check(await review.getAttribute('aria-expanded') === 'true', 'Review opens the review form');
  await page.keyboard.press('Escape');
  const repositoryHeading = sidebar.locator('[data-slot=sidebar-group-label]').filter({ hasText: 'Repositories' });
  const filesHeading = sidebar.locator('.file-tree > [data-slot=sidebar-group-label]');
  const textLeft = locator => locator.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().left; });
  ctx.check(await textLeft(repositoryHeading) === await textLeft(filesHeading), 'Repositories and Files heading text shares the same left edge');
  const repositories = sidebar.getByRole('button', { name: 'Repositories', exact: true });
  const filesTop = (await filesHeading.boundingBox()).y;
  await repositories.click();
  await sidebar.getByRole('link', { name: 'Add repository', exact: true }).waitFor({ state: 'hidden' });
  ctx.check(await repositories.getAttribute('aria-expanded') === 'false' && (await filesHeading.boundingBox()).y < filesTop, 'collapsing Repositories gives the space back to Files');
  await repositories.press('Enter');
  await sidebar.getByRole('link', { name: 'Add repository', exact: true }).waitFor();
  ctx.check(await repositories.getAttribute('aria-expanded') === 'true', 'Repositories expands again from the keyboard');
  ctx.check(await page.getByPlaceholder('Filter files').count() === 0, 'file search stays collapsed until requested');

  await sidebar.getByRole('button', { name: 'Search files', exact: true }).click();
  const filter = page.getByPlaceholder('Filter files');
  await page.waitForFunction(() => document.activeElement?.getAttribute('placeholder') === 'Filter files');
  await filter.fill('no-file-has-this-name-verify');
  await sidebar.getByText('No files match “no-file-has-this-name-verify”.', { exact: true }).waitFor();
  ctx.check(await sidebar.locator('.outline-empty').isVisible(), 'the search panel filters the files and reports no matches');
  await filter.press('Escape');
  ctx.check(await filter.count() === 0 && await sidebar.getByRole('button', { name: 'Search files', exact: true }).evaluate(el => el === document.activeElement), 'Escape clears file search and returns focus to its button');
  await page.locator('.pr-topbar .topbar-title').click();
  await page.keyboard.press('/');
  await filter.waitFor();
  ctx.check(await filter.inputValue() === '', 'the slash shortcut opens a clean file search panel');
  await filter.press('Escape');

  async function order(name) {
    await sidebar.getByRole('button', { name: 'File list display', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').filter({ hasText: 'Show files' }).waitFor({ state: 'hidden' });
  }
  await order('Diff order');
  ctx.check(await sidebar.locator('.list-file').count() === files.length, 'the display popover switches to a complete file list');
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-slot=sidebar-container]').getBoundingClientRect().right <= 0 && document.querySelector('.pr-page').getBoundingClientRect().left === 0);
  ctx.check(await page.locator('.pr-page').evaluate(el => el.getBoundingClientRect().left === 0), 'the shadcn trigger collapses the sidebar and releases its space');
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-slot=sidebar-container]').getBoundingClientRect().left === 0);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
  await page.waitForFunction(() => document.querySelector('[data-slot=sidebar]').getAttribute('data-state') === 'collapsed');
  ctx.check(true, 'the standard shadcn keyboard shortcut toggles the sidebar');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.querySelector('[data-slot=sidebar-container]').getBoundingClientRect().left === 0);
  ctx.check(await sidebar.boundingBox().then(box => box.width === bounds.width), 'the F shortcut restores the default sidebar width');
  await page.locator('.pr-topbar .topbar-title').click();
  await page.evaluate(() => scrollTo(0, 600));
  ctx.check((await sidebar.boundingBox()).y === 0 && (await sidebar.boundingBox()).height === bounds.height, 'page scrolling keeps the full sidebar in place');

  for (const view of ['Overview', 'Guide', 'Diff']) {
    await page.getByRole('navigation', { name: 'View', exact: true }).getByRole('link', { name: view, exact: true }).click();
    await page.locator(`.pr-page.view-${view.toLowerCase()}`).waitFor();
    ctx.check(await sidebar.isVisible() && await sidebar.locator('.file-tree').isVisible(), `${view} keeps navigation and files in the same sidebar`);
  }
  await page.getByRole('navigation', { name: 'View', exact: true }).getByRole('link', { name: 'Overview', exact: true }).click();
  await sidebar.locator('.list-file').first().click();
  await page.waitForURL(`${ctx.base}${path}/diff`);
  await ctx.waitForDiffRows();
  ctx.check(await ctx.visibleRows() > 0, 'choosing a file from Overview opens its drawn diff');

  await sidebar.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.goBack(); await sidebar.waitFor();
  ctx.check(await sidebar.isVisible(), 'app navigation works and Back restores the review sidebar');
  await order('Folders');
  await ctx.shot('sidebar-desktop');

  await page.setViewportSize({ width: 640, height: 900 });
  await page.reload(); await ctx.waitForDiffRows();
  ctx.check(await sidebar.count() === 0, 'small screens start with the sidebar closed');
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await sidebar.waitFor();
  const mobile = await sidebar.boundingBox();
  ctx.check(mobile.y === 0 && mobile.height === 900 && mobile.width < 640, 'the mobile sidebar opens as a full-height drawer');
  await ctx.shot('sidebar-mobile');
  await sidebar.getByRole('button', { name: 'File list display', exact: true }).click();
  ctx.check(await page.getByRole('button', { name: 'Folders', exact: true }).isVisible(), 'file display settings open above the mobile drawer');
  await page.keyboard.press('Escape');
  await sidebar.getByRole('button', { name: 'Close sidebar', exact: true }).click();
  await sidebar.waitFor({ state: 'detached' });
  ctx.check(await sidebar.count() === 0 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'closing the mobile drawer restores a page without horizontal overflow');
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await order('Diff order');
  await sidebar.locator('.list-file').first().click();
  await sidebar.waitFor({ state: 'detached' });
  ctx.check(await ctx.visibleRows() > 0, 'choosing a file closes the mobile Sheet and reveals the diff');
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await sidebar.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  ctx.check(await sidebar.count() === 0, 'app navigation closes the mobile Sheet too');
}
