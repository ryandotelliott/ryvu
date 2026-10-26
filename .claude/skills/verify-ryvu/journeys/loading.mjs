export default async function (ctx) {
  const { page } = ctx;
  await page.locator('a.pull-row').first().waitFor({ timeout: 60_000 });
  let gate = null, refusePosts = false, refusedPosts = 0;
  const hold = () => {
    let release, captured, timeout;
    const ready = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('No authenticated read was captured within 30 seconds.')), 30_000);
      captured = () => { clearTimeout(timeout); resolve(); };
    });
    const pending = { wait: new Promise(resolve => { release = resolve; }), ready, captured, release: () => { clearTimeout(timeout); gate = null; release(); }, url: '' };
    gate = pending;
    return pending;
  };
  const intercept = async route => {
    if (refusePosts && route.request().method() === 'POST') {
      refusedPosts++;
      return route.fulfill({ status: 400, body: 'This check must reuse the saved analysis.' });
    }
    const pending = gate;
    if (!pending || route.request().method() !== 'GET' || !route.request().headers()['x-review-token']) return route.continue();
    // route.fetch does not add the Fetch Metadata header Chromium sends on this same-origin request.
    const response = await route.fetch({ headers: { ...await route.request().allHeaders(), 'sec-fetch-site': 'same-origin' } });
    pending.url = route.request().url();
    pending.captured();
    await pending.wait;
    await route.fulfill({ response });
  };
  await page.route('**/_serverFn/**', intercept);
  try {
    for (const width of [1440, 640]) {
      await page.setViewportSize({ width, height: 900 });
      const pending = hold();
      await ctx.go('/');
      await pending.ready;
      const loading = await page.locator('.pull-row.skeleton').first().boundingBox();
      pending.release();
      await page.locator('a.pull-row').first().waitFor({ timeout: 60_000 });
      const loaded = await page.locator('a.pull-row').first().boundingBox();
      ctx.check(Math.abs(loading.y - loaded.y) < 1 && loading.height === loaded.height, `inbox skeleton rows keep their position and height at ${width}px`);
      await ctx.shot(`inbox-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const target = process.env.VERIFY_GUIDE_PR;
    if (!target) throw new Error('Set VERIFY_GUIDE_PR to a PR with a saved guide.');
    const pending = hold();
    await ctx.go(`/pr/${target.replace('#', '/')}/guide`);
    await pending.ready;
    const blocks = page.locator('.diff-card-body');
    ctx.check(await blocks.count() === 1 && await blocks.locator('[data-slot=skeleton]').count() === 1, 'the cold code placeholder is one solid block, without imitation code lines');
    await ctx.shot('solid-code-placeholder');
    pending.release();
    await page.locator('.section-rail button').first().waitFor({ timeout: 60_000 });
    const title = await page.locator('.pr-heading h1').innerText();
    await page.locator('[data-slot=sidebar]').getByRole('link', { name: 'Pull requests', exact: true }).click();
    await page.locator('a.pull-row').first().waitFor({ timeout: 60_000 });
    await page.locator(`a.pull-row:not([href=${JSON.stringify(`/pr/${target.replace('#', '/')}`)}])`).first().click();
    await page.locator('.pr-page:not([aria-busy=true])').waitFor({ timeout: 60_000 });
    await page.goBack();
    await page.locator('a.pull-row').first().waitFor({ timeout: 60_000 });
    const refresh = hold();
    await page.goBack();
    await refresh.ready;
    ctx.check(await page.locator('.section-rail button').count() > 0 && await page.locator('.pr-heading h1').innerText() === title, 'returning to a cached Guide shows its content while the refresh response is held');
    ctx.check(await page.locator('.pr-page[aria-busy=true]').count() === 0, 'a cached revisit does not return to the page skeleton');
    await ctx.shot('cached-guide');
    await page.getByRole('navigation', { name: 'View', exact: true }).getByRole('link', { name: 'Diff', exact: true }).click();
    await ctx.waitForDiffRows();
    const text = `verify-ryvu refresh draft ${Date.now()}`;
    await page.locator('.diff-card.expanded [data-line-type="change-addition"]').first().hover();
    await page.locator('.diff-card.expanded [data-utility-button]').first().click();
    await page.getByPlaceholder('Leave a comment').fill(text);
    await page.getByRole('button', { name: 'Add to review', exact: true }).click();
    await page.locator('.thread', { hasText: text }).waitFor();
    const response = page.waitForResponse(value => value.url() === refresh.url);
    refresh.release();
    await response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    ctx.check(await page.locator('.thread', { hasText: text }).count() === 1, 'a background refresh cannot overwrite a new local draft');
    await page.locator('.thread', { hasText: text }).getByRole('button', { name: 'Delete comment', exact: true }).click();
    await page.locator('.thread', { hasText: text }).waitFor({ state: 'detached' });

    await page.locator('[data-slot=sidebar]').getByRole('link', { name: 'Pull requests', exact: true }).click();
    await page.locator('a.pull-row').first().waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Find a pull request' }).click();
    await page.getByPlaceholder('Search pull requests, or paste a link or number').fill(`https://github.com/${target.replace(/\/([0-9]+)$/, '/pull/$1')}`);
    const openGuide = page.getByRole('option', { name: 'Open guide' });
    await openGuide.waitFor({ timeout: 60_000 });
    refusePosts = true;
    const analysisRefresh = hold();
    await openGuide.click();
    await analysisRefresh.ready;
    ctx.check(new URL(page.url()).searchParams.get('analyze') === '1', 'the Analyze shortcut waits for fresh PR data before deciding whether an analysis is needed');
    analysisRefresh.release();
    await page.waitForURL(url => url.pathname.endsWith('/guide') && !url.searchParams.has('analyze'));
    ctx.check(refusedPosts === 0 && await page.locator('.section-rail button').count() > 0, 'the Analyze shortcut reuses the saved Guide without starting another job');
    refusePosts = false;
  } finally {
    gate?.release();
    await page.unroute('**/_serverFn/**', intercept);
  }
}
