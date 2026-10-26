// A stacked PR's title opens its stack, top first, and picking another PR keeps the view. Set VERIFY_STACK_PR=owner/repo/number to a PR in a GitHub stack.
export default async function (ctx) {
  const { page } = ctx;
  const [owner, repo, number] = (process.env.VERIFY_STACK_PR ?? 'ryvn-technologies/ryvn/9508').split('/');
  const stacks = await ctx.github(`repos/${owner}/${repo}/stacks?pull_request=${number}`);
  const stack = stacks.flat()[0];
  ctx.check(stack?.pull_requests?.length > 1, `GitHub lists ${owner}/${repo}#${number} in a stack of ${stack?.pull_requests?.length}`);
  const expected = stack.pull_requests.map(pull => pull.number).reverse();
  const below = expected[expected.indexOf(Number(number)) + 1];

  await ctx.go(`/pr/${owner}/${repo}/${number}/diff`);
  const trigger = page.locator('.pr-topbar .stack-trigger');
  await trigger.waitFor({ timeout: 60_000 });
  ctx.check(await trigger.locator('.stack-icon').count() === 1 && (await trigger.innerText()).includes(`#${number}`), 'the top bar title shows the stack icon and this PR');
  await ctx.shot('stacked-title');

  await trigger.click();
  const rows = page.locator('.stack-menu .stack-row');
  await rows.first().waitFor();
  await page.locator('.stack-menu').evaluate(menu => Promise.all(menu.getAnimations().map(animation => animation.finished)));
  const numbers = (await rows.locator('.topbar-number').allInnerTexts()).map(text => Number(text.replace('#', '')));
  ctx.check(JSON.stringify(numbers) === JSON.stringify(expected), `the menu lists the stack top first: ${numbers.join(', ')}`);
  ctx.check(await page.locator('.stack-label').innerText() === `${expected.length} stacked`, 'the menu counts the stacked PRs');
  const current = page.locator('.stack-row[aria-current="page"]');
  ctx.check(await current.count() === 1 && (await current.innerText()).includes(`#${number}`), 'only this PR is marked current');
  ctx.check(await rows.locator('.stack-diff .added').count() === expected.length, 'every row shows its diff stats');
  ctx.check(await page.locator('.stack-menu .stack-checks').count() > 0, `rows show check dots (${await page.locator('.stack-menu .stack-checks').count()})`);
  ctx.check(await page.locator('.stack-base code').innerText() === stack.base.ref, `the base branch ${stack.base.ref} sits below the stack`);
  await ctx.shot('stack-menu');

  await page.keyboard.press('ArrowDown');
  ctx.check(await page.locator('.stack-row[data-highlighted]').count() === 1, 'arrow keys move through the rows');
  await page.locator(`.stack-row[href="/pr/${owner}/${repo}/${below}/diff"]`).click();
  await page.waitForURL(url => new URL(url).pathname === `/pr/${owner}/${repo}/${below}/diff`);
  await page.waitForSelector(`.pr-topbar .stack-trigger:has-text("#${below}")`, { timeout: 60_000 });
  ctx.check(await page.locator('.stack-menu').count() === 0, 'the menu closes after picking a PR');
  ctx.check(await page.locator('.view-tabs a[aria-current="page"]').innerText().then(text => text.trim() === 'Diff'), `#${below} opens on the same Diff view`);
  await ctx.shot('picked-below');

  for (const pull of await ctx.inbox()) {
    const [o, r] = pull.repo.split('/');
    if ((await ctx.github(`repos/${o}/${r}/stacks?pull_request=${pull.number}`)).flat().length) continue;
    await ctx.go(pull.path);
    await page.waitForSelector('.pr-topbar .topbar-title', { timeout: 60_000 });
    ctx.check(await page.locator('.pr-topbar .stack-trigger').count() === 0 && (await page.locator('.pr-topbar .topbar-title').innerText()).includes(`#${pull.number}`), `unstacked ${pull.repo}#${pull.number} keeps the plain title`);
    await ctx.shot('unstacked-title');
    return;
  }
  ctx.check(false, 'the inbox has an unstacked PR to compare');
}
