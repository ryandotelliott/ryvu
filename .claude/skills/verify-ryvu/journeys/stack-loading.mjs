export default async function (ctx) {
  const { page } = ctx;
  page.setDefaultTimeout(15_000);
  const [owner, repo, number] = (process.env.VERIFY_STACK_PR ?? 'ryvn-technologies/ryvn/9508').split('/');
  const base = `/pr/${owner}/${repo}`;
  await ctx.go(`${base}/${number}/diff`);
  const trigger = page.locator('.pr-topbar .stack-trigger');
  await trigger.waitFor({ timeout: 60_000 });
  await trigger.click();
  const next = page.locator('.stack-row:not([aria-current=page])').first();
  const path = await next.getAttribute('href');
  const cachedTitle = await next.locator('.stack-title').innerText();
  let loadingTitle = cachedTitle;
  if (ctx.instance.mode === 'dev') {
    loadingTitle = `${cachedTitle} (older cached title)`;
    await page.evaluate(async ({ repo, number, title }) => {
      const { remember } = await import('/src/web/browser-state.ts');
      remember([{ repo, number, title }]);
    }, { repo: `${owner}/${repo}`, number: Number(path.split('/').at(-2)), title: loadingTitle });
    ctx.note('Seeded an older title in the browser cache; GitHub data is unchanged.');
  }
  let release, captured;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { captured = resolve; });
  let armed = true;
  const intercept = async route => {
    if (armed && route.request().method() === 'GET' && route.request().headers()['x-review-token']) {
      armed = false;
      captured();
      await held;
    }
    await route.continue();
  };
  await page.route('**/_serverFn/**', intercept);
  try {
    await next.click();
    await ready;
    await page.waitForURL(url => url.pathname === path);
    await page.locator('.pr-page[aria-busy=true]').waitFor();
    const title = page.locator('.pr-topbar .topbar-title');
    ctx.check((await title.innerText()).includes(loadingTitle), 'while the PR response is held, the header shows its cached title');
    ctx.check(await title.locator('[data-slot=skeleton]').count() === 0, 'the known title does not flash a skeleton');
    await ctx.shot('cached-stack-title');
    release();
    await page.locator('.pr-page:not([aria-busy])').waitFor({ timeout: 60_000 });
    const fresh = ctx.github(`repos/${owner}/${repo}/pulls/${path.split('/').at(-2)}`);
    ctx.check((await title.innerText()).includes(fresh[0].title), 'after loading, the header shows the current title returned by GitHub');
    if (ctx.instance.mode === 'dev') ctx.check(!(await title.innerText()).includes(loadingTitle), 'the fetched title replaces the stale cached title');
    await ctx.shot('loaded-stack-title');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
}
