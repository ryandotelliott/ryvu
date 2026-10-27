// Files: a file header's actions open the whole file before or after the change, the new and changed lines are marked, the sidebar browses
// the repository at any branch with counts and a changed-only filter, and a comment on the whole file is kept as a local draft.

// A PR with a modified file that adds lines, so both the old and the new file exist and the new one has marks.
async function pickPull(ctx) {
  const pulls = await ctx.inbox();
  ctx.check(pulls.length > 0, `the seeded inbox lists pull requests (${pulls.length})`);
  for (const pull of pulls.slice(0, 10)) {
    const files = ctx.github(`repos/${pull.repo}/pulls/${pull.number}/files?per_page=100`);
    const file = files.find(item => item.status === 'modified' && typeof item.patch === 'string' && item.additions > 0);
    if (!file) continue;
    const [meta] = ctx.github(`repos/${pull.repo}/pulls/${pull.number}`);
    // The first added line's number in the new file.
    let line = 0, first = 0;
    for (const raw of file.patch.split('\n')) {
      const header = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (header) { line = Number(header[1]); continue; }
      if (raw.startsWith('+')) { first = line; break; }
      if (!raw.startsWith('-') && !raw.startsWith('\\')) line++;
    }
    ctx.note(`picked ${pull.repo}#${pull.number} "${pull.title}", file ${file.filename} (+${file.additions} −${file.deletions}, first new line ${first})`);
    return { pull, files, file, first, head: meta.head.ref, base: meta.base.ref };
  }
  throw new Error('none of the first ten inbox PRs modifies a file with added lines');
}

const codeRows = page => page.evaluate(() => document.querySelector('.file-viewer diffs-container')?.shadowRoot?.querySelectorAll('[data-line]').length ?? 0);
const search = page => new URL(page.url()).searchParams;

export default async function (ctx) {
  const { page } = ctx;
  const { pull, files, file, first, head, base } = await pickPull(ctx);
  await ctx.go(`${pull.path}/diff`);
  await ctx.waitForDiffRows();

  const card = page.locator('.diff-card').filter({ has: page.locator(`.file-toggle[aria-label$=" ${file.filename}"]`) });
  await card.locator('.file-menu').click();
  const items = page.getByRole('menuitem');
  ctx.check((await items.allInnerTexts()).join('|') === 'Add file comment|View old file|View new file', `the file menu offers ${(await items.allInnerTexts()).join(', ')}`);
  await ctx.shot('file-menu');

  await page.getByRole('menuitem', { name: 'View new file' }).click();
  await page.waitForFunction(() => (document.querySelector('.file-viewer diffs-container')?.shadowRoot?.querySelectorAll('[data-line]').length ?? 0) > 0, null, { timeout: 30000 });
  ctx.check(page.url().includes('/files?') && search(page).get('branch') === head && search(page).get('path') === file.filename, `View new file opens Files at ${head}: ${page.url()}`);
  ctx.check(await codeRows(page) > 0, 'the whole file draws code rows');
  const changes = (await page.locator('.files-changes .toolbar-progress').innerText()).trim();
  ctx.check(/^\d+ changes?$/.test(changes) && Number(changes.split(' ')[0]) > 0, `the toolbar counts "${changes}"`);
  ctx.check((await page.locator('.branch-trigger').innerText()).includes(head.slice(0, 12)), 'the branch picker shows the PR branch');
  ctx.check(/changed in this PR/.test(await page.locator('.branch-changes').innerText()), 'the sidebar counts the PR’s changed files');

  // j steps to the first change; its row is tinted and the unchanged first line isn’t.
  await page.keyboard.press('j'); await page.waitForTimeout(600);
  const marked = await page.evaluate(line => {
    const root = document.querySelector('.file-viewer diffs-container')?.shadowRoot;
    const row = root?.querySelector(`[data-line="${line}"]`), plain = [...(root?.querySelectorAll('[data-line]') ?? [])].find(element => getComputedStyle(element).backgroundColor !== getComputedStyle(row ?? element).backgroundColor);
    if (!row) return null;
    const box = row.getBoundingClientRect();
    return { visible: box.top > 0 && box.bottom < window.innerHeight, tinted: Boolean(plain) };
  }, first);
  ctx.check(marked?.visible === true, `j brings line ${first}, the first change, into view`);
  ctx.check(marked?.tinted === true, `line ${first} is tinted unlike unchanged lines`);
  await ctx.shot('new-file-marked');

  // Only changed files narrows the tree to the PR’s files.
  await page.locator('.branch-changes-toggle [role=switch]').click(); await page.waitForTimeout(600);
  const listed = await page.locator('.repo-files [data-item-type="file"]').count();
  ctx.check(listed === files.length, `only changed files lists ${listed} of ${files.length} PR files`);
  const other = files.find(item => item.filename !== file.filename && item.status !== 'removed');
  if (other) {
    await page.locator(`.repo-files [data-item-path="${other.filename}"]`).click(); await page.waitForTimeout(800);
    ctx.check(search(page).get('path') === other.filename && search(page).get('branch') === head, `clicking ${other.filename} in the tree opens it on the same branch`);
  }
  await page.locator('.branch-changes-toggle [role=switch]').click();
  await ctx.shot('changed-only');

  // View old file opens the base branch.
  await ctx.go(`${pull.path}/diff`); await ctx.waitForDiffRows();
  await card.locator('.file-menu').click();
  await page.getByRole('menuitem', { name: 'View old file' }).click();
  await page.waitForFunction(() => (document.querySelector('.file-viewer diffs-container')?.shadowRoot?.querySelectorAll('[data-line]').length ?? 0) > 0, null, { timeout: 30000 });
  ctx.check(search(page).get('branch') === base && search(page).get('path') === file.filename, `View old file opens Files at ${base}`);
  await ctx.shot('old-file');

  // The branch picker searches branches and switches, keeping the file.
  await page.locator('.branch-trigger').click();
  await page.getByPlaceholder('Find a branch…').fill(head.slice(-10));
  const option = page.getByRole('option', { name: new RegExp(head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  await option.waitFor({ timeout: 15000 });
  await ctx.shot('branch-search');
  await option.click(); await page.waitForTimeout(800);
  ctx.check(search(page).get('branch') === head && search(page).get('path') === file.filename, 'picking a branch switches to it and keeps the file');

  // Show diff returns to the file in the diff.
  await page.getByRole('button', { name: 'Show diff', exact: true }).click(); await page.waitForTimeout(1500);
  ctx.check(page.url().endsWith('/diff'), 'Show diff returns to the Diff tab');

  // A comment on the whole file: composer above the diff, a local pending draft, then deleted. Never submitted.
  const reviewCount = async () => Number((await page.locator('.topbar-actions .review-count').innerText().catch(() => '0')) || 0);
  const before = await reviewCount();
  await card.locator('.file-menu').click();
  await page.getByRole('menuitem', { name: 'Add file comment' }).click();
  const composer = card.locator('.file-comments textarea');
  await composer.waitFor();
  ctx.check(await composer.evaluate(element => element === document.activeElement), 'the file comment composer takes focus');
  ctx.check((await card.locator('.composer-label').innerText()).trim() === 'Comment on this file', 'the composer says it comments on the file');
  const note = `verify-ryvu file comment ${Date.now()}`;
  await page.keyboard.type(note);
  await card.locator('.file-comments').getByRole('button', { name: 'Add to review' }).click();
  // Other local drafts may already sit on this file, so find this one by its text.
  const draft = card.locator('.file-comments .thread.draft').filter({ hasText: note });
  await draft.waitFor();
  ctx.check(await draft.locator('.pending-chip').count() === 1 && await reviewCount() === before + 1, `the draft shows as pending and Review counts ${before + 1}`);
  await ctx.shot('file-comment');
  await draft.getByRole('button', { name: 'Delete comment' }).click();
  await draft.waitFor({ state: 'detached' });
  ctx.check(await reviewCount() === before, 'deleting the draft removes it from the review');

  // Another branch shows its changes against the default branch in the full tree, opened to the file.
  const [owner, name] = pull.repo.split('/');
  const defaultName = ctx.githubQuery('query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { defaultBranchRef { name } } }', { owner, name })[0].data.repository.defaultBranchRef.name;
  for (const other of (await ctx.inbox()).filter(item => item.number !== pull.number).slice(0, 10)) {
    const [meta] = ctx.github(`repos/${other.repo}/pulls/${other.number}`);
    const changed = meta.base.ref === defaultName && ctx.github(`repos/${other.repo}/pulls/${other.number}/files?per_page=100`).find(item => item.status === 'modified' && item.additions > 0);
    if (!changed) continue;
    await ctx.go(`${pull.path}/files?branch=${encodeURIComponent(meta.head.ref)}&path=${encodeURIComponent(changed.filename)}`);
    await page.locator('.branch-changes').filter({ hasText: `against ${defaultName}` }).waitFor({ timeout: 30000 });
    const row = page.locator(`.repo-files [data-item-path="${changed.filename}"]`);
    await row.waitFor({ timeout: 30000 });
    ctx.check(/\+\d+/.test(await row.innerText()), `on ${meta.head.ref}, ${changed.filename} shows its counts in the full tree (“${(await row.innerText()).replace(/\s+/g, ' ')}”; the PR lists +${changed.additions} −${changed.deletions})`);
    await ctx.shot('other-branch');
    break;
  }

  // The fourth tab key opens Files at the default branch.
  await ctx.go(pull.path); await page.waitForSelector('.activity');
  await page.keyboard.press('4'); await page.waitForTimeout(1000);
  ctx.check(page.url().endsWith('/files'), 'key 4 opens Files');
  await page.locator('.repo-files [data-item-type]').first().waitFor({ timeout: 30000 });
  ctx.check(/default/.test(await page.locator('.branch-trigger').innerText()), 'Files opens on the default branch');
  await ctx.shot('default-branch');
}
