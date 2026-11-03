import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// Local drafts only. Never submits a review to GitHub.
export default async function (ctx) {
  const { page } = ctx;
  const target = process.env.VERIFY_COMMENT_PR;
  if (!target) throw new Error('Set VERIFY_COMMENT_PR to a PR with two consecutive lines in its patch.');
  const filePath = process.env.VERIFY_COMMENT_FILE || 'internal/auth/auth.go';
  const start = Number(process.env.VERIFY_COMMENT_START || 1448), end = start + 1;
  const side = process.env.VERIFY_COMMENT_SIDE || 'additions';
  const layout = process.env.VERIFY_COMMENT_LAYOUT || 'unified';
  const gesture = process.env.VERIFY_COMMENT_GESTURE || 'numbers';
  const reverse = process.env.VERIFY_COMMENT_REVERSE === '1';
  ctx.note(`${layout}, ${side}, ${gesture}, ${reverse ? 'upward' : 'downward'} drag`);
  await ctx.go(`/pr/${target}/diff`);
  await ctx.waitForDiffRows();
  if (layout === 'split') {
    await page.getByRole('button', { name: 'Display settings', exact: true }).click();
    await page.getByRole('radio', { name: 'Split view', exact: true }).click();
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'File list display', exact: true }).click();
  await page.getByRole('button', { name: 'Diff order', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search files', exact: true }).click();
  await page.getByPlaceholder('Filter files').fill(filePath);
  await page.locator('.list-file').first().click();
  await page.keyboard.press('Escape');
  const card = page.locator('.diff-card').filter({ has: page.locator(`.file-toggle[aria-label$=${JSON.stringify(` ${filePath}`)}]`) });
  const column = layout === 'split' ? `[data-code][data-${side}]` : '[data-code]';
  const gutter = number => card.locator(`${column} [data-gutter] [data-column-number="${number}"]`).first();
  const code = number => card.locator(`${column} [data-line="${number}"]`).first();
  async function point(locator, text = false) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('The selected line is not drawn.');
    const gutterRight = text ? await locator.evaluate(line => line.closest('[data-code]').querySelector('[data-gutter]').getBoundingClientRect().right) : box.x;
    return { x: text ? Math.max(box.x, gutterRight) + 10 : box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  async function drag(a, b) {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  }
  async function revealRange() {
    await page.locator('.list-file').first().click();
    let stable = 0;
    for (let step = 0; step < 100; step++) {
      const box = await gutter(end).boundingBox();
      if (box && box.y > 128 && box.y + box.height < 850) {
        if (++stable === 3) return;
      } else {
        stable = 0;
        if (box) await gutter(end).scrollIntoViewIfNeeded();
        else { await page.mouse.move(1000, 600); await page.mouse.wheel(0, 500); }
      }
      await page.waitForTimeout(100);
    }
    throw new Error(`Lines ${start}-${end} did not settle in the viewport.`);
  }
  await revealRange();
  const contextLine = await card.locator(`${column} [data-line-type="context"][data-line]`).evaluateAll(lines => {
    const line = lines.find(line => { const box = line.getBoundingClientRect(); return box.top > 108 && box.bottom < 850; });
    return line ? Number(line.dataset.line) : null;
  });
  ctx.check(contextLine !== null, 'an unchanged line is visible for the selection checks');
  await gutter(contextLine).click();
  ctx.check(await card.locator(`${column} [data-line][data-selected-line]`).count() === 1, 'clicking an unchanged line number selects one row');
  for (const [locator, kind] of [[code(contextLine), 'code'], [gutter(contextLine), 'gutter']]) {
    const tintRatio = await locator.evaluate(line => {
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      const originalMix = line.hasAttribute('data-column-number') ? dark ? 60 : 75 : dark ? 75 : 82;
      const oldBackground = line.style.backgroundColor;
      const color = () => getComputedStyle(line).backgroundColor.match(/[-\d.]+/g).slice(0, 3).map(Number);
      const selected = color();
      line.style.backgroundColor = 'color-mix(in lab, var(--diffs-computed-diff-line-bg) 100%, transparent)';
      const background = color();
      line.style.backgroundColor = `color-mix(in lab, var(--diffs-computed-diff-line-bg) ${originalMix}%, var(--diffs-selection-mix-target))`;
      const original = color();
      line.style.backgroundColor = oldBackground;
      const distance = value => Math.hypot(...value.map((component, i) => component - background[i]));
      return distance(selected) / distance(original);
    });
    ctx.check(Math.abs(tintRatio - 0.9) < 0.005, `the ${kind} selection tint is 10% weaker (ratio ${tintRatio.toFixed(3)})`);
  }
  await ctx.shot('context-line-selected');
  if (layout === 'split') {
    const otherSide = side === 'additions' ? 'deletions' : 'additions';
    ctx.check(await card.locator(`[data-code][data-${otherSide}] [data-line][data-selected-line]`).count() === 0, 'selecting a context line highlights only the clicked split column');
    const index = (await code(contextLine).getAttribute('data-line-index')).split(',').at(-1);
    const otherLine = await card.locator(`[data-code][data-${otherSide}] [data-line][data-line-index$=",${index}"]`).getAttribute('data-line');
    await card.locator(`[data-code][data-${otherSide}] [data-column-number="${otherLine}"]`).click();
    ctx.check(await card.locator(`[data-code][data-${otherSide}] [data-line][data-selected-line]`).count() === 1 && await card.locator(`${column} [data-line][data-selected-line]`).count() === 0, 'clicking the matching line in the other gutter moves selection to that column');
    await gutter(contextLine).click();
    ctx.check(await card.locator(`${column} [data-line][data-selected-line]`).count() === 1, 'clicking back in the original gutter moves selection back');
  }
  const contextPoint = await point(code(contextLine), true);
  await page.mouse.click(contextPoint.x, contextPoint.y);
  ctx.check(await card.locator('[data-selected-line]').count() === 0, 'clicking code outside the gutter clears the line selection');
  if (layout === 'split') {
    const otherSide = side === 'additions' ? 'deletions' : 'additions';
    const otherLine = await card.locator(`[data-code][data-${otherSide}] [data-line-type="context"][data-line]`).evaluateAll(lines => {
      const line = lines.find(line => { const box = line.getBoundingClientRect(); return box.top > 108 && box.bottom < 850; });
      return line ? Number(line.dataset.line) : null;
    });
    ctx.check(otherLine !== null, 'an unchanged line is visible in the other split editor');
    const otherCode = card.locator(`[data-code][data-${otherSide}] [data-line="${otherLine}"]`);
    await gutter(contextLine).click();
    const otherPoint = await point(otherCode, true);
    await page.mouse.click(otherPoint.x, otherPoint.y);
    ctx.check(await card.locator('[data-selected-line]').count() === 0, 'clicking the other split editor clears the line selection');
  }
  await ctx.shot('code-click-cleared-selection');
  await revealRange();
  if (gesture === 'double-click') {
    const word = await code(start).evaluate(line => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, match = node.textContent.match(/\w{2,}/);
        if (!match) continue;
        const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2, text: match[0] };
      }
      throw new Error('The test line needs a word to double-click.');
    });
    await page.mouse.dblclick(word.x, word.y);
    ctx.check(await page.evaluate(() => document.getSelection()?.toString()) === word.text, 'double-clicking code keeps normal word selection');
    ctx.check(await card.locator('[data-selected-line]').count() === 0, 'double-clicking code does not select a comment line');
    ctx.check(await page.locator('.composer-label').count() === 0, 'double-clicking code does not open a comment composer');
    await ctx.shot('double-click-word-only');
    await drag(await point(gutter(start)), await point(gutter(end)));
  } else if (gesture === 'text') {
    const a = await point(code(start), true), b = await point(code(end), true);
    b.x += 30;
    await drag(reverse ? b : a, reverse ? a : b);
    ctx.check(await card.locator('[data-selected-line]').count() === 0, 'dragging code text does not select comment lines');
    ctx.check((await page.evaluate(() => document.getSelection()?.toString())).includes('\n'), 'the browser has a native multi-line text selection');
    ctx.check(await page.locator('.composer-label').count() === 0, 'dragging code text does not open a comment composer');
    await ctx.shot('code-text-only');
    await gutter(start).click();
    const single = await card.locator(`${column} [data-line][data-selected-line]`).evaluateAll(nodes => nodes.map(node => Number(node.dataset.line)));
    ctx.check(single.length === 1 && single[0] === start, 'clicking a line number selects exactly that line');
    await gutter(start).click();
    await page.waitForFunction(() => [...document.querySelectorAll('diffs-container')].every(container => !container.shadowRoot?.querySelector('[data-selected-line]')));
    ctx.check(await card.locator('[data-selected-line]').count() === 0, 'clicking the selected line number clears its selection');
    const wideStart = Number(process.env.VERIFY_COMMENT_WIDE_START || start - 6);
    await drag(await point(gutter(wideStart)), await point(gutter(end)));
    await drag(reverse ? b : a, reverse ? a : b);
    ctx.check(await card.locator('[data-selected-line]').count() === 0, 'dragging code text clears an existing line-number selection');
    await drag(await point(gutter(reverse ? end : start)), await point(gutter(reverse ? start : end)));
  } else if (gesture === 'plus') {
    await gutter(reverse ? end : start).hover();
    await drag(await point(card.locator('[data-utility-button]')), await point(gutter(reverse ? start : end)));
  } else {
    await drag(await point(gutter(reverse ? end : start)), await point(gutter(reverse ? start : end)));
  }
  const selected = await card.locator(`${column} [data-line][data-selected-line]`).evaluateAll(nodes => nodes.map(node => Number(node.dataset.line)));
  ctx.check(selected.length === 2 && selected.includes(start) && selected.includes(end), `exactly lines ${start}–${end} are highlighted (observed ${selected.join(', ')})`);
  if (gesture !== 'plus') {
    await page.getByRole('button', { name: 'Display settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Wrap long lines', exact: true }).click();
    await page.keyboard.press('Escape');
    await code(end).waitFor();
    const redrawn = await card.locator(`${column} [data-line][data-selected-line]`).evaluateAll(nodes => nodes.map(node => Number(node.dataset.line)));
    ctx.check(redrawn.length === 2 && redrawn.includes(start) && redrawn.includes(end), 'the selected range survives a renderer remount after changing display settings');
  }
  if (layout === 'split') {
    const otherSide = side === 'additions' ? 'deletions' : 'additions';
    ctx.check(await card.locator(`[data-code][data-${otherSide}] [data-line][data-selected-line]`).count() === 0, 'dragging a range highlights only the selected split column');
  }
  await ctx.shot('two-lines-selected');
  if (gesture !== 'plus') {
    await gutter(end).hover();
    const buttonBox = await card.locator('[data-utility-button]').boundingBox(), gutterBox = await gutter(end).boundingBox();
    ctx.check(buttonBox.x >= gutterBox.x && buttonBox.x + buttonBox.width <= gutterBox.x + gutterBox.width + 1, 'the comment button stays inside the line-number gutter');
    await card.locator('[data-utility-button]').click();
  }
  const label = page.locator('.composer-label');
  await label.waitFor();
  ctx.check(await label.innerText() === `Comment on lines ${start}–${end}`, `the composer keeps the two-line selection (observed ${await label.innerText()})`);
  const body = `verify-ryvu two-line comment ${crypto.randomUUID()}`;
  await page.getByPlaceholder('Leave a comment').fill(body);
  ctx.check(await card.locator(`${column} [data-line][data-selected-line]`).count() === 2, 'typing a comment preserves the selected range');
  await page.getByRole('button', { name: 'Add to review', exact: true }).click();
  const draft = page.locator('.comment-fold').filter({ hasText: body });
  await draft.waitFor();
  ctx.check((await draft.innerText()).includes(`lines ${start}–${end}`), 'the local draft displays exactly the selected lines');
  const db = new DatabaseSync(join(ctx.instance.dataDir, 'ryvu.db'), { readOnly: true });
  try {
    const saved = db.prepare('SELECT side, start_line, line FROM drafts WHERE body = ?').get(body);
    ctx.check(saved?.side === side && saved.start_line === start && saved.line === end, 'the stored GitHub comment coordinates retain the exact side and endpoints');
  } finally { db.close(); }
  ctx.check(await card.locator('[data-selected-line]').count() === 0, 'adding the comment clears the line highlight');
  ctx.check(!await page.evaluate(() => document.getSelection()?.toString()), 'adding the comment clears the native text selection');
  await ctx.shot('comment-added-selection-cleared');
  await draft.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await draft.waitFor({ state: 'detached' });
}
