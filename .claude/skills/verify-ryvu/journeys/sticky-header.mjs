import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickLargePull } from './_pick.mjs';

// Records real compositor frames (CDP screencast) during a fast wheel scroll and checks that nothing but page background, card surface and
// border colours shows in the 16px gap above the pinned header, its rounded top corners, or its top border line. A screenshot taken at rest
// can't catch this: the leak lives in frames the compositor draws before the main thread catches up with the scroll.
export default async function (ctx) {
  const { page } = ctx;
  const path = process.env.VERIFY_GUIDE_PR ? `/pr/${process.env.VERIFY_GUIDE_PR}/guide` : `${(await pickLargePull(ctx)).path}/diff`;
  await ctx.go(path);
  await ctx.waitForDiffRows();
  await page.evaluate(() => document.querySelectorAll('.diff-card:not(.expanded) .file-toggle').forEach(button => button.click()));
  await page.mouse.move(900, 500);
  await page.mouse.wheel(0, 600); await page.waitForTimeout(800);

  const geometry = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement), card = document.querySelector('.diff-card').getBoundingClientRect();
    const g = new OffscreenCanvas(1, 1).getContext('2d');
    const rgb = name => { g.fillStyle = css.getPropertyValue(name).trim(); g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data).slice(0, 3); };
    return { left: Math.round(card.left), right: Math.round(card.right), top: parseFloat(getComputedStyle(document.querySelector('.pr-page')).getPropertyValue('--sticky-top')), palette: ['--background', '--surface', '--card', '--border', '--muted'].map(rgb) };
  });
  ctx.note(`header pins at ${geometry.top}px; cards span x ${geometry.left}–${geometry.right}`);

  const cdp = await page.context().newCDPSession(page), frames = [];
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => { frames.push(data); await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 350); await page.waitForTimeout(8); }
  await page.waitForTimeout(600);
  await cdp.send('Page.stopScreencast');
  ctx.check(frames.length > 30, `captured ${frames.length} frames while scrolling about 21,000px`);

  const leaks = await page.evaluate(async ({ frames, geometry }) => {
    const { left: L, right: R, top: T, palette } = geometry;
    const near = (p, q, t) => Math.abs(p[0] - q[0]) <= t && Math.abs(p[1] - q[1]) <= t && Math.abs(p[2] - q[2]) <= t;
    // Anti-aliased edges blend two palette colours, so accept points near the segment between any pair.
    const blend = p => palette.some(a => palette.some(b => Array.from({ length: 11 }, (_, k) => k / 10).some(t => near(p, a.map((v, i) => v + (b[i] - v) * t), 8))));
    const zones = { gap: [], corners: [], topLine: [] };
    for (let y = T - 16; y < T; y += 2) for (let x = L; x < R; x += 6) zones.gap.push([x, y]);
    for (let y = T; y < T + 8; y++) for (let x = 0; x < 7; x++) zones.corners.push([L + x, y], [R - 1 - x, y]);
    for (let x = L + 12; x < R - 12; x += 3) zones.topLine.push([x, T]);
    const found = [];
    for (const [index, data] of frames.entries()) {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const g = new OffscreenCanvas(image.width, image.height).getContext('2d'); g.drawImage(image, 0, 0);
      const scale = image.width / innerWidth, px = ([x, y]) => Array.from(g.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data);
      const bad = {
        gap: zones.gap.filter(point => !near(px(point), palette[0], 3)).length,
        corners: zones.corners.filter(point => !blend(px(point))).length,
        topLine: zones.topLine.filter(point => !blend(px(point))).length,
      };
      if (bad.gap || bad.corners || bad.topLine) found.push({ index, ...bad });
    }
    return found;
  }, { frames, geometry });

  const worst = [...leaks].sort((a, b) => (b.gap + b.corners + b.topLine) - (a.gap + a.corners + a.topLine));
  for (const { index, ...bad } of worst.slice(0, 6)) {
    writeFileSync(join(ctx.out, `leak-frame-${index}.png`), Buffer.from(frames[index], 'base64'));
    ctx.note(`saved leak-frame-${index}.png (off-palette pixels: ${JSON.stringify(bad)})`);
  }
  ctx.check(leaks.length === 0, `no frame shows code around the pinned header (${leaks.length} of ${frames.length} did)`);
}
