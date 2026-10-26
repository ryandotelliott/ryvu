import { execFileSync } from 'node:child_process';

export default async function (ctx) {
  const { page } = ctx;
  const viewer = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim();
  const tabs = page.getByRole('navigation', { name: 'Pull request lists' });
  const tab = name => tabs.getByRole('link', { name: new RegExp(`^${name}`) });
  const rows = () => page.locator('a.pull-row').evaluateAll(nodes => nodes.map(row => ({
    path: new URL(row.href).pathname,
    author: row.querySelector('.pull-meta').textContent.split(' by ').at(-1),
    review: Boolean(row.querySelector('.chip.review')),
    guide: Boolean(row.querySelector('.chip.guide')),
    at: row.querySelector('time').dateTime,
  })));
  const settled = () => page.waitForFunction(() => !document.querySelector('.pull-groups[aria-busy=true]'));
  let gate = null;
  function hold() {
    let resume, captured, timeout;
    const ready = new Promise((resolve, reject) => { captured = () => { clearTimeout(timeout); resolve(); }; timeout = setTimeout(() => reject(new Error('No list request was captured within 30 seconds.')), 30_000); });
    const waiting = new Promise(resolve => { resume = resolve; });
    const pending = { captured, waiting, release: () => { clearTimeout(timeout); if (gate === pending) gate = null; resume(); } };
    gate = pending;
    return { ready, release: pending.release };
  }
  async function intercept(route) {
    const pending = gate;
    if (!pending || route.request().method() !== 'GET' || !route.request().headers()['x-review-token']) return route.continue();
    const response = await route.fetch({ headers: { ...await route.request().allHeaders(), 'sec-fetch-site': 'same-origin' } });
    pending.captured(); await pending.waiting; await route.fulfill({ response });
  }
  function ordered(items, label) {
    ctx.check(items.every((row, index) => index === 0 || items[index - 1].at >= row.at), `${label}: rows use descending date order`);
    ctx.check(new Set(items.map(row => row.path)).size === items.length, `${label}: merged rows contain no duplicates`);
  }
  await ctx.inbox(); await settled();
  await page.route('**/_serverFn/**', intercept);
  try {
    for (const [name, matches] of [
      ['Authored by me', row => row.author === viewer],
      ['Review requested', row => row.review],
      ['Guide ready', row => row.guide],
    ]) {
      await tab('All open').click(); await settled();
      const known = (await rows()).filter(matches);
      const pending = hold();
      await tab(name).click(); await pending.ready;
      const partial = await rows();
      ctx.check(known.every(row => partial.some(item => item.path === row.path)) && partial.every(matches), `${name}: matching cached rows appear before its response (${known.length} known)`);
      ctx.check(await page.getByText(/^That’s (all|the only)/).count() === 0, `${name}: a partial list does not claim completion`);
      if (known.length) ctx.check(await page.locator('.pull-row.skeleton').count() === 0, `${name}: cached rows replace the page skeleton`);
      ordered(partial, name);
      await ctx.shot(`partial-${name.toLowerCase().replaceAll(' ', '-')}`);
      pending.release(); await settled(); ordered(await rows(), `${name} after fetch`);
    }
    await tab('All open').click(); await settled();
    const previous = await rows();
    await page.getByRole('button', { name: 'List options', exact: true }).click();
    await page.getByRole('button', { name: /^Sort by/ }).click();
    const pending = hold();
    await page.getByRole('radio', { name: 'Recently created', exact: true }).click(); await pending.ready;
    ctx.check((await rows()).length >= previous.length, 'changing sort immediately reuses known rows');
    ordered(await rows(), 'created sort before fetch');
    pending.release(); await settled();
    await page.keyboard.press('Escape');
    for (const name of ['Authored by me', 'Review requested', 'Guide ready', 'All open']) {
      await tab(name).click(); await settled();
      ctx.check(new URL(page.url()).searchParams.get('sort') === 'created', `${name}: the shared sort remains selected`);
      ordered(await rows(), name);
    }
    const before = await rows();
    await page.locator('a.pull-row').first().click();
    await page.locator('[data-slot=sidebar]').getByRole('link', { name: 'Pull requests', exact: true }).click();
    ctx.check(await page.locator('a.pull-row').count() >= before.length, 'returning from a PR retains the cached list');
    ctx.check((await page.locator('.pull-group-heading').allTextContents()).every(text => text.startsWith('Created ')), 'returning from a PR retains the shared sort');
    await ctx.go('/'); await page.locator('a.pull-row').first().waitFor(); await settled();
    ctx.check((await page.locator('.pull-group-heading').allTextContents()).every(text => text.startsWith('Created ')), 'the chosen sort survives a full page reload');
  } finally {
    gate?.release();
    await page.unroute('**/_serverFn/**', intercept);
  }
}
