import { pickLargePull } from './_pick.mjs';

export default async function (ctx) {
  const { page } = ctx;
  const { path, files } = await pickLargePull(ctx);
  const file = files.find(file => file.patched && file.added.length > 80);
  ctx.check(Boolean(file), 'the PR has a long diff to scroll through');
  await ctx.go(`${path}/diff`);
  await ctx.waitForDiffRows();
  const card = page.locator(`[id="file-${encodeURIComponent(file.path).replace(/%/g, '_')}"]`);
  const sidebar = page.locator('.file-tree');
  const row = () => sidebar.locator('.list-file.is-current, [data-item-type="file"][aria-selected="true"]').first();
  const progress = () => row().evaluate(el => ({
    value: Number(getComputedStyle(el).getPropertyValue('--file-progress')),
    background: getComputedStyle(el).backgroundImage,
    path: el.getAttribute('data-item-path') ?? el.querySelector('.filename')?.textContent
  }));
  for (const mode of ['Folders', 'Diff order']) {
    await page.getByRole('button', { name: 'File list display', exact: true }).click();
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Search files', exact: true }).click();
    const filter = page.getByPlaceholder('Filter files');
    await filter.fill(file.path);
    await sidebar.locator(`.list-file, [data-item-type="file"]`).first().click();
    await page.waitForFunction(id => Math.abs(document.getElementById(id).getBoundingClientRect().top - 108) < 2, await card.getAttribute('id'));
    await filter.press('Escape');
    const start = await progress();
    ctx.check(start.background.includes('linear-gradient') && start.value < 0.02, `${mode}: the active file starts with an empty progress fill`);
    const height = (await card.boundingBox()).height;
    await page.mouse.move(1000, 650);
    await page.mouse.wheel(0, Math.round(height * 0.25));
    await page.waitForTimeout(400);
    const middle = await progress();
    ctx.check(middle.path === start.path && middle.value > start.value + 0.1 && middle.value < 0.8, `${mode}: scrolling down grows the fill within the same file (${middle.value.toFixed(2)})`);
    await ctx.shot(`progress-${mode === 'Folders' ? 'tree' : 'list'}`);
    await page.mouse.wheel(0, -Math.round(height * 0.15));
    await page.waitForTimeout(400);
    const back = await progress();
    ctx.check(back.path === start.path && back.value < middle.value - 0.05, `${mode}: scrolling up reduces the fill (${back.value.toFixed(2)})`);
    await page.keyboard.press('j');
    await page.waitForFunction(previous => {
      const sidebar = document.querySelector('.file-tree');
      const tree = sidebar.querySelector('.changed-file-tree');
      const active = tree?.shadowRoot?.querySelector('[data-item-type="file"][aria-selected="true"]') ?? sidebar.querySelector('.list-file.is-current');
      const path = active?.getAttribute('data-item-path') ?? active?.querySelector('.filename')?.textContent;
      return path && path !== previous && Number(getComputedStyle(active).getPropertyValue('--file-progress')) < 0.02;
    }, back.path);
    ctx.check(true, `${mode}: moving to the next file starts that row's fill at zero`);
  }
}
