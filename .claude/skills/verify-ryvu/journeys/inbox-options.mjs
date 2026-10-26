export default async function (ctx) {
  const { page } = ctx;
  await ctx.inbox();
  const tabs = page.getByRole('navigation', { name: 'Pull request lists' });
  ctx.check(await tabs.getByRole('link').count() === 4, 'the four list tabs stay visible');
  ctx.check(await page.locator('.filters button').count() === 1, 'the remaining controls share one List options button');
  ctx.check((await page.locator('.pull-group-heading').allTextContents()).every(text => text.startsWith('Updated ')), 'the default sort groups by update date');
  const first = await page.locator('a.pull-row').first().getAttribute('href');
  const [, owner, repo, number] = first.match(/^\/pr\/([^/]+)\/([^/]+)\/(\d+)$/);
  const repository = `${owner}/${repo}`;
  const author = (await page.locator('.pull-meta').first().innerText()).split(' by ').at(-1);
  const root = page.getByRole('dialog', { name: 'Filters', exact: true }).and(page.locator('[data-open]'));
  async function options() { if (!(await root.isVisible())) await page.getByRole('button', { name: /^List options/ }).click(); }
  async function select(label, search, query, choice) {
    await options(); await root.locator('[data-slot=combobox-trigger]').filter({ hasText: label }).click();
    const input = page.getByPlaceholder(search);
    await input.fill(query); await page.getByRole('option', { name: choice, exact: true }).click();
  }
  const loaded = async () => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator('a.pull-row').first().waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => !document.querySelector('.pull-groups[aria-busy=true]'));
  };
  await options(); await root.locator('[data-slot=combobox-trigger]').filter({ hasText: 'Repository' }).click();
  await page.getByPlaceholder('Find a repository…').fill('no-such-repository-verify');
  await page.getByText('No matches', { exact: true }).waitFor();
  await page.getByPlaceholder('Find a repository…').press('Escape');
  ctx.check(await root.isVisible(), 'Escape closes the search subpanel and keeps List options open');
  await select('Repository', 'Find a repository…', repository, repository);
  await page.waitForURL(url => url.searchParams.get('repo') === repository); await loaded();
  ctx.check((await page.locator('a.pull-row').evaluateAll(rows => rows.map(row => new URL(row.href).pathname))).every(path => path.startsWith(`/pr/${repository}/`)), 'the searchable repository filter applies to the list');
  await select('Repository', 'Find a repository…', '', 'All repositories');
  await page.waitForURL(url => !url.searchParams.has('repo')); await loaded();
  await select('Author', 'Find an author…', author, author);
  await page.waitForURL(url => url.searchParams.get('author') === author); await loaded();
  ctx.check((await page.locator('a.pull-row .pull-meta').allTextContents()).every(text => text.endsWith(`by ${author}`)), 'the searchable author filter applies to the list');
  await select('Author', 'Find an author…', '', 'Anyone');
  await page.waitForURL(url => !url.searchParams.has('author')); await loaded();
  await options(); await root.getByRole('button', { name: /^Drafts/ }).click();
  await page.getByRole('radio', { name: 'Hide drafts', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('drafts') === 'hidden'); await loaded();
  ctx.check(await page.locator('a.pull-row.is-draft').count() === 0, 'the draft subpanel can hide drafts');
  await options(); await root.getByRole('button', { name: /^Drafts/ }).click();
  await page.getByRole('radio', { name: 'Show drafts', exact: true }).click();
  await loaded();
  async function sort(choice) {
    await options(); await root.getByRole('button', { name: /^Sort by/ }).click();
    await page.getByRole('radio', { name: choice, exact: true }).click();
    await loaded();
  }
  await sort('Recently created');
  await page.locator('.pull-group-heading').filter({ hasText: /^Created / }).first().waitFor();
  ctx.check((await page.locator('.pull-group-heading').allTextContents()).every(text => text.startsWith('Created ')), 'created sorting changes the section labels');
  const createdFirst = await page.locator('a.pull-row').first().getAttribute('href');
  const [, co, cr, cn] = createdFirst.match(/^\/pr\/([^/]+)\/([^/]+)\/(\d+)$/);
  const expected = ctx.github(`repos/${co}/${cr}/pulls/${cn}`)[0];
  ctx.check(await page.locator('a.pull-row time').first().getAttribute('datetime') === expected.created_at, 'created sorting displays the creation timestamp from GitHub');
  await ctx.shot('created-groups');
  await sort('Repository');
  await page.waitForURL(url => url.searchParams.get('sort') === 'repo'); await loaded();
  async function checkRepositories() {
    const groups = await page.locator('.pull-group').evaluateAll(groups => groups.map(group => ({ name: group.getAttribute('aria-label'), paths: [...group.querySelectorAll('a.pull-row')].map(row => new URL(row.href).pathname) })));
    ctx.check(groups.length > 0 && groups.every(group => group.paths.every(path => path.startsWith(`/pr/${group.name}/`))), 'each repository section contains only that repository');
    ctx.check(groups.map(group => group.name).join('|') === groups.map(group => group.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).join('|'), 'repository sections are alphabetical');
    const paths = groups.flatMap(group => group.paths);
    ctx.check(paths.length === new Set(paths).size, 'loaded pages contain no duplicate PRs');
  }
  await checkRepositories();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  const before = await page.locator('a.pull-row').count();
  if (await page.locator('.pull-groups > [aria-busy="true"]').count()) {
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(before => document.querySelectorAll('a.pull-row').length > before || !document.querySelector('.pull-groups > [aria-busy="true"]'), before, { timeout: 60_000 });
    await checkRepositories();
    ctx.check(await page.locator('a.pull-row').count() > before, 'scrolling loads another repository-sorted page');
  }
  await page.evaluate(() => scrollTo(0, 0)); await ctx.shot('repository-groups');
  await page.setViewportSize({ width: 520, height: 900 });
  await page.waitForTimeout(250);
  await page.evaluate(() => scrollTo(0, 0));
  await options(); await root.locator('[data-slot=combobox-trigger]').filter({ hasText: 'Repository' }).click();
  await page.getByPlaceholder('Find a repository…').waitFor();
  await page.waitForTimeout(250);
  const fits = await page.locator('[data-slot="combobox-content"]').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  ctx.check(fits, 'the nested search panel fits on a narrow screen');
  ctx.check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && scrollX === 0), 'the list stays within the narrow viewport without horizontal scrolling');
  await ctx.shot('mobile-options');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(250);
  ctx.check(await page.locator('[data-slot=combobox-content]').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width >= 200; }), 'the search panel remains usable at phone width');
  ctx.check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the phone layout has no horizontal overflow');
}
