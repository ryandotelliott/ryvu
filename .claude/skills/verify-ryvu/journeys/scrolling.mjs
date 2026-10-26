import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickLargePull } from './_pick.mjs';

export default async function (ctx) {
  const { page } = ctx;
  const { path } = await pickLargePull(ctx);
  await ctx.go(`${path}/diff`);
  await ctx.waitForDiffRows();
  await page.evaluate(() => scrollTo(0, 500));

  async function checkPopover(trigger, popup, label) {
    await trigger.click();
    await popup.waitFor();
    await page.waitForTimeout(200);
    // A coloured inset lets us locate the popup in compositor frames before positioning updates run on the main thread.
    const geometry = await popup.evaluate(el => {
      const previous = el.style.boxShadow;
      el.style.boxShadow = 'inset 3px 0 rgb(249, 0, 249)';
      return { x: Math.floor(el.getBoundingClientRect().left) + 1, previous };
    });
    await ctx.shot(`${label}-open`);
    const cdp = await page.context().newCDPSession(page), frames = [];
    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      frames.push(data);
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    const before = await page.evaluate(() => scrollY);
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await page.waitForTimeout(100);
    await page.mouse.move(800, 700);
    for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(16); }
    await page.waitForTimeout(200);
    await cdp.send('Page.stopScreencast');
    await cdp.detach();
    const tops = await page.evaluate(async ({ frames, x }) => {
      const tops = [];
      for (const data of frames) {
        const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
        const g = new OffscreenCanvas(image.width, image.height).getContext('2d'); g.drawImage(image, 0, 0);
        const scale = image.width / innerWidth;
        let top = null;
        for (let y = 0; y < image.height; y++) {
          const p = g.getImageData(Math.round(x * scale), y, 1, 1).data;
          if (p[0] > 240 && p[1] < 10 && p[2] > 240) { top = y / scale; break; }
        }
        tops.push(top);
      }
      return tops;
    }, { frames, x: geometry.x });
    await popup.evaluate((el, previous) => { el.style.boxShadow = previous; }, geometry.previous);
    const bad = tops.flatMap((top, i) => top === null || Math.abs(top - tops[0]) > 2 ? [i] : []);
    for (const i of bad.slice(0, 3)) writeFileSync(join(ctx.out, `${label}-movement-${i}.png`), Buffer.from(frames[i], 'base64'));
    ctx.check(frames.length > 10 && tops[0] !== null, `${label}: captured ${frames.length} painted frames with the popup visible`);
    ctx.check((await page.evaluate(() => scrollY)) - before >= 2500, `${label}: the page scrolls behind the open popup`);
    ctx.check(bad.length === 0, `${label}: the popup stays attached to its sticky trigger in every frame (${bad.length} moved)`);
    await ctx.shot(`${label}-scrolled`);
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
  }

  await checkPopover(page.getByRole('button', { name: 'Display settings', exact: true }), page.locator('.display-popover'), 'display');
  await checkPopover(page.getByRole('button', { name: 'Review', exact: true }), page.getByRole('dialog').filter({ hasText: 'Finish your review' }), 'review');
  if (!(await page.locator('.file-tree').count())) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
  const fileDisplay = page.getByRole('button', { name: 'File list display' });
  const filePopup = page.getByRole('dialog').filter({ hasText: 'Show files' });
  await checkPopover(fileDisplay, filePopup, 'file-display');

  async function chooseOrder(name) {
    await fileDisplay.click();
    await page.getByRole('button', { name, exact: true }).click();
    await page.keyboard.press('Escape');
    await filePopup.waitFor({ state: 'hidden' });
  }
  async function checkSidebar(scroller, label) {
    await scroller.waitFor();
    await page.evaluate(() => scrollTo(0, 500));
    await page.waitForTimeout(200);
    const range = await scroller.evaluate(el => el.scrollHeight - el.clientHeight);
    ctx.check(range > 400, `${label}: the fixture has ${range}px of sidebar scrolling`);
    const wheel = async delta => {
      const box = await scroller.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(250);
    };
    const y = await page.evaluate(() => scrollY);
    await scroller.evaluate(el => { el.scrollTop = 0; });
    await wheel(200);
    ctx.check(await scroller.evaluate(el => el.scrollTop > 0), `${label}: wheeling inside scrolls the sidebar`);
    ctx.check(await page.evaluate(() => scrollY) === y, `${label}: scrolling inside leaves the code page still`);
    for (const edge of ['bottom', 'top']) {
      await scroller.evaluate((el, edge) => { el.scrollTop = edge === 'bottom' ? el.scrollHeight : 0; }, edge);
      await wheel(edge === 'bottom' ? 400 : -400);
      ctx.check(await page.evaluate(() => scrollY) === y, `${label}: wheeling past the ${edge} stays in the sidebar`);
    }
    await ctx.shot(label);
  }
  await chooseOrder('Diff order');
  await checkSidebar(page.locator('.changed-file-list'), 'file-list');
  await chooseOrder('Folders');
  await checkSidebar(page.locator('.changed-file-tree [data-file-tree-virtualized-scroll]'), 'folder-tree');
  ctx.check(await ctx.visibleRows() > 0, 'the code view still draws lines after scrolling');
}
