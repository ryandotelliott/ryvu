import { pickLargePull } from './_pick.mjs';

export default async function (ctx) {
  const { page } = ctx;
  const { files, path } = await pickLargePull(ctx);
  const wrapped = files.find(file => file.path.length > 60 && file.path.includes('-'));
  const unbroken = files.find(file => file.path.split('/').at(-1).length > 40 && !file.path.includes('-'));
  ctx.check(Boolean(wrapped && unbroken), 'the PR has long hyphenated and unbroken file paths');
  await ctx.go(`${path}/diff`); await ctx.waitForDiffRows();
  const tabs = page.getByRole('navigation', { name: 'View', exact: true });
  for (const [label, trigger] of [
    ['Diff', tabs.getByRole('link', { name: 'Diff', exact: true })],
    ['Guide', tabs.getByRole('link', { name: 'Guide', exact: true })],
    ['Overview', tabs.getByRole('link', { name: 'Overview', exact: true })],
    ['Hide sidebar', page.getByRole('button', { name: 'Hide sidebar', exact: true })],
    ['Search files', page.getByRole('button', { name: 'Search files', exact: true })],
    ['Pull requests', page.locator('.pr-topbar a[aria-label="Pull requests"]')],
  ]) {
    await trigger.hover();
    const popup = page.locator('[data-slot="tooltip-content"][data-open]').filter({ hasText: label });
    await popup.waitFor();
    const singleLine = await popup.evaluate(async el => {
      await Promise.allSettled(el.getAnimations({ subtree: true }).map(animation => animation.finished));
      const text = el.querySelector('span');
      return text.getBoundingClientRect().height <= parseFloat(getComputedStyle(text).lineHeight) + 1;
    });
    ctx.check(singleLine, `the short tooltip "${label}" stays on one line`);
    await ctx.shot(`short-${label.replaceAll(' ', '-')}`);
  }
  await page.getByRole('button', { name: 'File list display', exact: true }).click();
  await page.getByRole('button', { name: 'Diff order', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search files', exact: true }).click();
  const filter = page.getByPlaceholder('Filter files');
  for (const file of [wrapped, unbroken]) {
    await filter.fill(file.path);
    await page.locator('.list-file').first().hover();
    const popup = page.locator('[data-slot="tooltip-content"]').filter({ hasText: file.path });
    await popup.waitFor();
    const geometry = await popup.evaluate(async el => {
      await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished));
      const range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), lines = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        range.selectNodeContents(node); lines.push(...[...range.getClientRects()].filter(rect => rect.width && rect.height));
      }
      const box = el.getBoundingClientRect(), css = getComputedStyle(el);
      return { width: box.width, padding: parseFloat(css.paddingLeft) + parseFloat(css.paddingRight), lines: lines.map(rect => ({ left: rect.left, right: rect.right, width: rect.width })), left: box.left, right: box.right };
    });
    ctx.check(geometry.lines.every(line => line.left >= geometry.left && line.right <= geometry.right), `${file.path}: all text stays inside the tooltip`);
    const gap = geometry.width - geometry.padding - Math.max(...geometry.lines.map(line => line.width));
    ctx.check(gap >= -1 && gap <= 3, `${file.path}: the box fits its longest line (${gap.toFixed(1)}px extra)`);
    await ctx.shot(file === wrapped ? 'wrapped-path' : 'unbroken-path');
  }
  await filter.press('Escape');
  await page.getByRole('button', { name: 'Search files', exact: true }).hover();
  const shortcut = page.locator('[data-slot="tooltip-content"]').filter({ hasText: 'Search files' });
  await shortcut.waitFor();
  ctx.check(await shortcut.locator('kbd').innerText() === '/', 'the shortcut stays next to its tooltip label');
  await page.setViewportSize({ width: 520, height: 900 });
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Search files', exact: true }).click();
  await filter.fill(wrapped.path);
  await page.locator('.list-file').first().hover();
  const mobile = page.locator('[data-slot="tooltip-content"]').filter({ hasText: wrapped.path });
  await mobile.waitFor();
  for (const width of [520, 480]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const fits = await mobile.evaluate(el => {
      const box = el.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(el.querySelector('span') ?? el);
      const text = range.getBoundingClientRect(), css = getComputedStyle(el);
      return box.left >= 0 && box.right <= innerWidth && text.left >= box.left && text.right <= box.right && box.width - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - text.width < 3;
    });
    ctx.check(fits, `the wrapped tooltip fits its text and viewport at ${width}px`);
  }
  await ctx.shot('narrow-tooltip');
}
