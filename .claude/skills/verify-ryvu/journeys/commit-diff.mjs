// An activity commit opens its changes against its parent, with its own progress and pinned file contents.
export default async function (ctx) {
  const { page } = ctx;
  const configured = process.env.VERIFY_COMMIT_PR?.split('/');
  const candidates = configured ? [{ repo: configured.slice(0, 2).join('/'), number: Number(configured[2]) }] : (await ctx.inbox()).slice(0, 10);
  let picked;
  for (const pull of candidates) {
    const commits = await ctx.github(`repos/${pull.repo}/pulls/${pull.number}/commits?per_page=100`);
    if (commits.length >= 3) { picked = { ...pull, commits }; break; }
  }
  ctx.check(Boolean(picked), 'a real PR has at least three commits');
  const { repo, number, commits } = picked, commit = commits[1], sha = commit.sha, parent = commit.parents[0].sha;
  const compared = (await ctx.github(`repos/${repo}/compare/${parent}...${sha}?per_page=100`))[0];
  const expected = compared.files, message = commit.commit.message.split('\n')[0];
  ctx.check(expected.length > 0 && expected.length < 300, `GitHub compares ${expected.length} files against parent ${parent.slice(0, 7)}`);
  const base = `/pr/${repo}/${number}`, selected = `${base}/diff?commit=${sha}`;
  const loaded = () => page.waitForSelector('.pr-page:not([aria-busy]) .view-tabs', { timeout: 120_000 });
  const selectedLoaded = async () => { await page.waitForURL(url => url.pathname + url.search === selected); await page.locator('.commit-heading').waitFor({ timeout: 120_000 }); };
  const progress = () => page.locator('.diff-toolbar > .toolbar-progress').innerText();

  await ctx.go(base);
  await loaded();
  await page.getByRole('button', { name: 'Activity display', exact: true }).click();
  const showCommits = page.locator('[data-slot="switch"][aria-label="Show commits"]');
  if (await showCommits.getAttribute('aria-checked') !== 'true') await showCommits.click();
  await page.keyboard.press('Escape');
  const link = page.locator(`.activity-commit[href="${selected}"]`);
  await link.scrollIntoViewIfNeeded();
  ctx.check(await link.locator('.commit-sha').innerText() === sha.slice(0, 7), 'the activity commit links to its own diff');
  await ctx.shot('activity-commit');
  await link.locator('.commit-message').click();
  await selectedLoaded();
  ctx.check(await page.locator('.commit-heading h1').innerText() === message, 'clicking the commit message opens that commit');
  ctx.check((await page.locator('.commit-heading .review-meta').innerText()).includes(parent.slice(0, 7)), 'the heading identifies the real parent, rather than another activity entry');
  const paths = await page.locator('.diff-card').evaluateAll(cards => cards.map(card => card.querySelector('.file-toggle').getAttribute('aria-label').replace(/^(Expand|Collapse) /, '')));
  ctx.check(JSON.stringify(paths) === JSON.stringify(expected.map(file => file.filename)), 'the changed files exactly match GitHub’s parent-to-commit comparison');
  const additions = expected.reduce((sum, file) => sum + file.additions, 0), deletions = expected.reduce((sum, file) => sum + file.deletions, 0);
  ctx.check(await page.locator('.diff-toolbar .added').innerText() === `+${additions.toLocaleString('en-US')}` && await page.locator('.diff-toolbar .removed').innerText() === `−${deletions.toLocaleString('en-US')}`, 'addition and deletion counts match the selected commit');
  await ctx.waitForDiffRows();
  ctx.check(await ctx.visibleRows() > 0, 'the commit draws actual diff rows');
  const first = expected.find(file => file.patch && file.status !== 'removed');
  ctx.check(Boolean(first), 'the commit has a readable file');
  const card = page.locator(`[id="file-${encodeURIComponent(first.filename).replace(/%/g, '_')}"]`);
  await card.scrollIntoViewIfNeeded();
  const addedLine = first.patch.split('\n').find(line => line.startsWith('+') && line.slice(1).trim());
  if (addedLine) {
    await card.locator('diffs-container [data-line-type="change-addition"]').first().waitFor({ state: 'attached' });
    ctx.check((await card.locator('diffs-container [data-line-type="change-addition"]').allTextContents()).some(text => text.includes(addedLine.slice(1))), 'drawn added code matches the selected commit’s patch');
  }
  ctx.check(await page.locator('.topbar-actions button, .comment-fold, .comment-indicator').count() === 0, 'the historical diff has no PR review controls or unrelated comments');
  ctx.check((await page.getByRole('link', { name: 'Open commit on GitHub' }).getAttribute('href')).endsWith(`/commit/${sha}`), 'the GitHub link opens the selected commit');
  await ctx.shot('commit-diff');

  await card.locator('.file-reviewed [role="checkbox"]').click();
  ctx.check(await progress() === `1/${expected.length} reviewed`, 'Reviewed updates commit progress');
  await page.reload();
  await selectedLoaded();
  ctx.check(await progress() === `1/${expected.length} reviewed`, 'the commit deep link and its progress survive reload');
  await page.getByRole('link', { name: 'All changes', exact: true }).click();
  await loaded();
  ctx.check(new URL(page.url()).search === '' && await page.locator('.commit-heading').count() === 0, 'All changes returns to the full PR diff');
  ctx.check((await progress()).startsWith('0/'), 'commit progress does not mark a file reviewed in the full PR');
  await ctx.shot('all-changes');
  await page.goBack();
  await selectedLoaded();
  ctx.check(await progress() === `1/${expected.length} reviewed`, 'Back restores the commit and its own progress');

  await card.locator('.file-reviewed [role="checkbox"]').click();
  await page.getByRole('button', { name: `Actions for ${first.filename}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'View new file', exact: true }).click();
  await page.waitForURL(url => url.pathname === `${base}/files` && url.searchParams.get('commit') === sha && url.searchParams.get('branch') === sha);
  await page.locator('.file-viewer diffs-container [data-line]').first().waitFor({ state: 'attached', timeout: 120_000 });
  ctx.check(new URL(page.url()).searchParams.get('path') === first.filename, 'View new file is pinned to the selected commit');
  await ctx.shot('commit-file');
  await page.locator('.view-tabs').getByRole('link', { name: 'Diff', exact: true }).click();
  await selectedLoaded();
  ctx.check(await progress() === `0/${expected.length} reviewed`, 'returning from Files keeps the selected commit');
  await page.locator('.view-tabs').getByRole('link', { name: 'Overview', exact: true }).click();
  await page.waitForURL(url => url.pathname === base && !url.search);
  await loaded();
  await page.locator(`.activity-commit[href="${selected}"] .commit-sha`).click();
  await selectedLoaded();
  ctx.check(true, 'clicking the commit SHA also opens its diff');

  await page.locator('.view-tabs').getByRole('link', { name: 'Overview', exact: true }).click();
  await loaded();
  const head = commits[commits.length - 1];
  await page.locator(`.activity-commit[href="${base}/diff?commit=${head.sha}"]`).click();
  await page.waitForURL(url => url.searchParams.get('commit') === head.sha);
  await page.locator('.commit-heading').waitFor({ timeout: 120_000 });
  ctx.check(await page.locator('.commit-heading h1').innerText() === head.commit.message.split('\n')[0], 'selecting another activity commit replaces the diff');
  await page.locator('.diff-card .file-reviewed [role="checkbox"]').first().click();
  ctx.check((await progress()).startsWith('1/'), 'the head commit also keeps its own progress');
  await page.getByRole('link', { name: 'All changes', exact: true }).click();
  await page.waitForURL(url => !url.search);
  ctx.check((await progress()).startsWith('0/'), 'head-commit progress stays separate from the full PR at the same SHA');
  await page.goBack();
  await page.locator('.commit-heading').waitFor();

  await page.setViewportSize({ width: 640, height: 900 });
  await page.locator('.commit-heading').scrollIntoViewIfNeeded();
  ctx.check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the commit heading fits a narrow viewport');
  await ctx.shot('commit-narrow');
}
