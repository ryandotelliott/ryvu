export default async function (ctx) {
  const { page } = ctx;
  const pulls = await ctx.inbox();
  ctx.check(pulls.length > 0, `the inbox lists pull requests (${pulls.length})`);
  const pull = pulls[0], base = pull.path;
  const path = () => { const url = new URL(page.url()); return url.pathname + url.search; };
  const view = async () => {
    await page.waitForSelector('.pr-page:not([aria-busy]) .view-tabs a[aria-current="page"]', { timeout: 60_000 });
    return (await page.locator('.view-tabs a[aria-current="page"]').allInnerTexts()).map(text => text.trim()).join(',');
  };

  for (const [suffix, label] of [['', 'Overview'], ['/guide', 'Guide'], ['/diff', 'Diff'], ['/changes', 'Diff']]) {
    await ctx.go(base + suffix);
    ctx.check(await view() === label && path() === base + suffix, `opening ${base + suffix} directly shows ${label} and keeps the URL`);
  }
  await ctx.shot('changes-alias');

  await ctx.go('/#/settings');
  await page.waitForSelector('.settings h1');
  ctx.check(path() === '/settings', `an old #/settings link opens /settings (${path()})`);
  await ctx.go(`/#${base}/diff`);
  ctx.check(await view() === 'Diff' && path() === `${base}/diff`, `an old #/pr/…/diff link opens the Diff view at ${path()}`);
  for (const [bad, home] of [['/no/such/page', '/'], ['/no/such/page?tab=review', '/?tab=review'], [`${base.replace(/\/\d+$/, '')}/not-a-number`, '/'], [`${base}/history`, '/']]) {
    await ctx.go(bad);
    await page.waitForSelector('a.pull-row:not(.skeleton), .empty', { timeout: 60_000 });
    ctx.check(path() === home, `${bad} lands on the pull request list at ${path()}`);
  }

  await page.evaluate(() => { window.__verifyMarker = 'kept'; });
  const kept = () => page.evaluate(() => window.__verifyMarker === 'kept');
  await page.locator('nav.tabs a', { hasText: 'Review requested' }).click();
  await page.waitForURL(/\?tab=review$/);
  ctx.check(path() === '/?tab=review' && await page.locator('nav.tabs a[aria-current="page"]').innerText().then(text => text.startsWith('Review requested')), 'the Review requested tab link sets ?tab=review and marks itself current');
  await page.goBack(); await page.waitForURL(url => new URL(url).search === '');
  ctx.check(await page.locator('nav.tabs a[aria-current="page"]').innerText().then(text => text.startsWith('All open')), 'back returns to All open');

  await page.locator(`a.pull-row[href="${base}"]`).click();
  ctx.check(await view() === 'Overview' && path() === base, `clicking the row opens its Overview at ${path()}`);
  await page.locator('.view-tabs a', { hasText: 'Guide' }).click();
  ctx.check(await view() === 'Guide' && path() === `${base}/guide`, 'the Guide tab opens /guide');
  await page.keyboard.press('3');
  ctx.check(await view() === 'Diff' && path() === `${base}/diff`, 'key 3 opens /diff');
  await ctx.shot('diff-by-key');
  await page.goBack();
  ctx.check(await view() === 'Guide' && path() === `${base}/guide`, 'back returns to the Guide');
  await page.goBack();
  ctx.check(await view() === 'Overview' && path() === base, 'back again returns to the Overview');
  await page.goForward();
  ctx.check(await view() === 'Guide' && path() === `${base}/guide`, 'forward returns to the Guide');
  ctx.check(await page.locator('.pr-topbar a[href="/"]').count() === 0, 'the top bar has no back arrow');
  await page.locator('[data-slot=sidebar]').getByRole('link', { name: 'Pull requests', exact: true }).click();
  await page.waitForSelector('a.pull-row:not(.skeleton)', { timeout: 60_000 });
  ctx.check(path() === '/', 'the sidebar’s Pull requests link returns to the list');
  await page.goBack();
  ctx.check(await view() === 'Guide', 'back from the list reopens the PR on the view you left');
  ctx.check(await kept(), 'none of these steps reloaded the page');
  await ctx.shot('after-history');
}
