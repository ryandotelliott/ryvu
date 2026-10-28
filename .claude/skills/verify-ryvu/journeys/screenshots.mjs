// Uploads a generated test image to GitHub, saves/deletes a local draft, and never submits a comment or review.
export default async function (ctx) {
  const { page } = ctx, descriptionPR = process.env.VERIFY_SCREENSHOT_PR, uploadPR = process.env.VERIFY_UPLOAD_PR;
  if (!descriptionPR || !uploadPR) throw new Error('Set VERIFY_SCREENSHOT_PR to a PR with screenshots and VERIFY_UPLOAD_PR to a PR in a repository you can write to.');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ctx.base });
  await ctx.go(`/pr/${descriptionPR}`);
  const description = page.locator('.description-text');
  await description.locator('img.markdown-image').first().waitFor({ timeout: 60_000 });
  const screenshots = description.locator('img.markdown-image[src^="data:"]');
  await screenshots.first().waitFor({ timeout: 60_000 });
  const image = screenshots.first();
  await image.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.description-text img[src^="data:"]')].some(image => image.complete && image.naturalWidth > 0));
  ctx.check(await image.evaluate(image => image.naturalWidth > 0), 'a real private GitHub screenshot renders in the description using gh authentication');
  ctx.check(await image.evaluate(image => image.getBoundingClientRect().width <= image.closest('.description-text').getBoundingClientRect().width), 'description screenshots fit their container');
  await ctx.shot('description-screenshot');
  await page.setViewportSize({ width: 520, height: 850 });
  await image.scrollIntoViewIfNeeded();
  ctx.check(await image.evaluate(image => image.getBoundingClientRect().right <= innerWidth && image.getBoundingClientRect().width <= image.closest('.description-text').getBoundingClientRect().width), 'description screenshots also fit a narrow viewport');
  await ctx.shot('description-narrow');
  await page.setViewportSize({ width: 1440, height: 900 });

  await ctx.go(`/pr/${uploadPR}/diff`);
  await ctx.waitForDiffRows();
  await page.getByRole('button', { name: /^Actions for / }).first().click();
  await page.getByRole('menuitem', { name: 'Add file comment' }).click();
  const area = page.getByPlaceholder('Leave a comment');
  await area.fill('Before paste.\nAfter paste.');
  await area.evaluate(area => area.setSelectionRange(14, 14));
  const clipboardSize = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 320;
    const context = canvas.getContext('2d'), pixels = context.createImageData(640, 320);
    let seed = 12345;
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      for (let channel = 0; channel < 3; channel++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[offset + channel] = seed >>> 24; }
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0); context.fillStyle = '#e8edf4'; context.fillRect(20, 70, 600, 80);
    context.fillStyle = '#203047'; context.font = '24px sans-serif'; context.fillText('Ryvu screenshot upload verification', 40, 120);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return blob.size;
  });
  ctx.check(clipboardSize > 262_144, 'the screenshot fixture exceeds the normal JSON request limit');
  await area.press(`${modifier}+v`);
  await page.getByText('Uploading screenshot to GitHub…', { exact: true }).waitFor();
  ctx.check(await page.getByRole('button', { name: 'Add to review', exact: true }).isDisabled(), 'saving a draft waits for the screenshot upload');
  await area.evaluate(area => area.setSelectionRange(area.value.length, area.value.length));
  await page.keyboard.insertText('\nTyped during upload.');
  await page.waitForFunction(() => {
    const value = document.querySelector('textarea[placeholder="Leave a comment"]')?.value ?? '';
    const failure = document.querySelector('.comment-editor [role=alert]');
    if (failure) throw new Error(failure.textContent);
    return value.includes('![Screenshot](https://github.com/user-attachments/assets/') && !value.includes('Uploading screenshot');
  }, null, { timeout: 90_000 });
  const body = await area.inputValue(), url = body.match(/https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+/)[0];
  ctx.check(body.includes('Before paste.') && body.includes('After paste.') && body.includes('Typed during upload.'), 'Cmd/Ctrl+V uploads to GitHub without losing surrounding text or concurrent typing');
  ctx.note(`uploaded generated test screenshot ${url}`);
  await area.fill(`${body}\n\n<img width="320" alt="HTML screenshot" src="${url}" onerror="globalThis.__screenshotXss=true">\n<script>globalThis.__screenshotXss=true</script>\n\n\`<img src="https://example.com/literal.png">\``);
  await page.getByRole('button', { name: 'Add to review', exact: true }).click();
  const draft = page.locator('.thread.draft').filter({ hasText: 'Before paste.' });
  await draft.locator('img.markdown-image').first().waitFor({ timeout: 60_000 });
  await draft.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.thread.draft img.markdown-image')].filter(image => image.complete && image.naturalWidth === 640).length === 2);
  ctx.check(await draft.locator('img.markdown-image').count() === 2, 'Markdown and GitHub HTML image syntax both render in a pending comment');
  ctx.check(await draft.locator('script, iframe, [onerror]').count() === 0 && !(await page.evaluate(() => globalThis.__screenshotXss)), 'HTML image support strips executable markup and keeps code spans literal');
  await ctx.shot('comment-screenshots');
  await page.reload();
  await draft.waitFor({ timeout: 60_000 });
  await draft.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.thread.draft img')].some(image => image.complete && image.naturalWidth === 640));
  ctx.check(true, 'the saved screenshot URL and rendered local draft survive reload');
  await draft.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await draft.waitFor({ state: 'detached' });

  const line = page.locator('.diff-card.expanded [data-line-type="change-addition"]').first();
  await line.hover();
  await page.locator('.diff-card.expanded [data-utility-button]').first().click();
  await area.fill(`Inline screenshot\n\n![Screenshot](${url})`);
  await page.getByRole('button', { name: 'Add to review', exact: true }).click();
  const inline = page.locator('.thread.draft').filter({ hasText: 'Inline screenshot' });
  await inline.locator('img').waitFor({ timeout: 60_000 });
  await inline.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.thread.draft img')].some(image => image.complete && image.naturalWidth === 640));
  ctx.check(await inline.evaluate(thread => {
    const image = thread.querySelector('img').getBoundingClientRect(), box = thread.closest('.annotation').getBoundingClientRect();
    return image.height > 0 && image.top >= box.top && image.bottom <= box.bottom + 1;
  }), 'an image in a line comment fits the diff annotation after loading');
  await ctx.shot('inline-screenshot');
  await inline.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await inline.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const summary = page.getByPlaceholder('Leave a summary (optional for approvals)');
  await summary.fill('Summary text.');
  await summary.evaluate(area => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['no'], 'file.txt', { type: 'text/plain' }));
    area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await page.getByText('Paste a PNG, JPEG, GIF or WebP screenshot.', { exact: true }).waitFor();
  ctx.check(await summary.inputValue() === 'Summary text.', 'review summaries handle file paste and retain text when the file is unsupported');
  await summary.evaluate(area => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['not really a PNG'], 'file.png', { type: 'image/png' }));
    area.setSelectionRange(area.value.length, area.value.length);
    area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector('textarea[placeholder="Leave a summary (optional for approvals)"]')?.value === 'Summary text.' && document.querySelector('[role=alert]')?.textContent.includes('Paste a PNG'));
  ctx.check(await summary.inputValue() === 'Summary text.', 'a server-rejected screenshot leaves the summary intact and reports the failure');
  await summary.fill('');
  await page.evaluate(() => navigator.clipboard.writeText('Plain clipboard text'));
  await summary.press(`${modifier}+v`);
  ctx.check(await summary.inputValue() === 'Plain clipboard text', 'ordinary text paste still works');
  await summary.fill('');
  await page.keyboard.press('Escape');
  ctx.check(await page.locator('.thread.draft').filter({ hasText: 'Before paste.' }).count() === 0, 'the local test draft was removed without submitting a GitHub review');
}
