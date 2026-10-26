export default async function (ctx) {
  const { page } = ctx;
  const target = process.env.VERIFY_GUIDE_PR;
  if (!target) throw new Error('Set VERIFY_GUIDE_PR to a saved Guide with a referenced line range.');
  await ctx.go(`/pr/${target.replace('#', '/')}/guide`);
  await page.locator('.section-rail button').first().waitFor({ timeout: 60_000 });
  const section = page.locator('.chapter-section').last();
  await section.locator('.chapter-file').first().click();
  const card = section.locator('.diff-card').first();
  const filePath = (await card.locator('.file-toggle').getAttribute('aria-label')).replace(/^(Expand|Collapse) /, '');
  const selected = () => card.locator('[data-line][data-selected-line]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-line'))));
  const gutter = (inCard, line) => inCard.locator(`[data-gutter] [data-column-number="${line}"]:not([data-line-type=change-deletion])`);
  async function drag(inCard, start, end) {
    await gutter(inCard, start).waitFor({ state: 'visible' });
    await gutter(inCard, end).waitFor({ state: 'visible' });
    const a = await gutter(inCard, start).boundingBox(), b = await gutter(inCard, end).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
  }
  await card.locator('[data-line][data-selected-line]').first().waitFor();
  const referenced = await selected();
  ctx.check(referenced.length > 1, `the file chip highlights its saved Guide reference (${referenced.join(', ')})`);
  const line = await card.locator('[data-gutter] [data-column-number]').evaluateAll((nodes, referenced) => {
    const node = nodes.find(node => !referenced.includes(Number(node.getAttribute('data-column-number'))) && node.getAttribute('data-line-type') !== 'change-deletion');
    return node ? Number(node.getAttribute('data-column-number')) : null;
  }, referenced);
  ctx.check(line !== null, 'there is another drawn line outside that reference to select');
  await gutter(card, line).click();
  await page.waitForTimeout(100);
  const chosen = await selected();
  ctx.note(`after selecting ${line}: ${chosen.join(', ')}`);
  ctx.check(chosen.length === 1 && chosen[0] === line, 'clicking another gutter line replaces the Guide reference');
  await gutter(card, line).click();
  ctx.check((await selected()).length === 0, 'clicking the selected line again clears it');
  const start = referenced[1], end = referenced.at(-1), range = referenced.slice(1);
  await drag(card, start, end);
  ctx.check(JSON.stringify(await selected()) === JSON.stringify(range), 'dragging line numbers selects a new multi-line range');
  await page.getByRole('button', { name: 'Display settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Wrap long lines', exact: true }).click();
  await page.keyboard.press('Escape');
  await card.scrollIntoViewIfNeeded();
  await card.locator('[data-line][data-selected-line]').first().waitFor();
  ctx.check(JSON.stringify(await selected()) === JSON.stringify(range), 'redrawing the diff preserves the user-selected range');
  const away = await page.context().browser().newPage();
  try { await away.goto('about:blank'); await away.bringToFront(); await page.bringToFront(); }
  finally { await away.close(); }
  ctx.check(JSON.stringify(await selected()) === JSON.stringify(range), 'returning from another tab preserves the user-selected range');
  await ctx.shot('manual-selection');
  await section.locator('.chapter-file').first().click();
  ctx.check(JSON.stringify(await selected()) === JSON.stringify(referenced), 'clicking the Guide file chip explicitly restores its reference');
  await page.getByRole('navigation', { name: 'View', exact: true }).getByRole('link', { name: 'Diff', exact: true }).click();
  const diffCard = page.locator(`.diff-card:has(.file-toggle[aria-label$=${JSON.stringify(` ${filePath}`)}])`);
  if (await diffCard.locator('.file-toggle').getAttribute('aria-expanded') !== 'true') await diffCard.locator('.file-toggle').click();
  await diffCard.scrollIntoViewIfNeeded();
  ctx.check(await diffCard.locator('[data-selected-line]').count() === 0, 'Diff starts with its own selection instead of the Guide reference');
  await drag(diffCard, start, end);
  const diffSelected = await diffCard.locator('[data-line][data-selected-line]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-line'))));
  ctx.check(JSON.stringify(diffSelected) === JSON.stringify(range), 'multi-line gutter selection also works in Diff');
  await gutter(diffCard, end).hover();
  await diffCard.locator('[data-utility-button]').click();
  await page.getByText(`Comment on lines ${start}–${end}`, { exact: true }).waitFor();
  ctx.check(true, 'the comment composer uses the selected start and end lines');
  const body = `verify-ryvu selected range ${Date.now()}`;
  await page.getByPlaceholder('Leave a comment').fill(body);
  await page.getByRole('button', { name: 'Add to review', exact: true }).click();
  await page.locator('.thread', { hasText: body }).waitFor();
  await page.reload();
  await ctx.waitForDiffRows();
  await diffCard.scrollIntoViewIfNeeded();
  const draft = page.locator('.comment-fold', { hasText: body });
  await draft.waitFor();
  ctx.check((await draft.innerText()).includes(`lines ${start}–${end}`), 'the saved local draft retains its multi-line range after reload');
  await draft.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await draft.waitFor({ state: 'detached' });
}
