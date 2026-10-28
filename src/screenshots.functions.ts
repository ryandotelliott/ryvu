import { createServerFn } from '@tanstack/react-start';
import { fields, parseRepo, UserError } from './domain';
import { isGithubScreenshot, MAX_SCREENSHOT_BYTES, screenshotTypes } from './screenshots';
import { readScreenshot as read, uploadScreenshot as upload } from './screenshots.server';

export const uploadScreenshot = createServerFn({ method: 'POST' })
  .validator((input: FormData) => {
    if (!(input instanceof FormData)) throw new UserError('Paste a screenshot first.', 400);
    const file = input.get('file'), repo = parseRepo(input.get('repo'));
    if (!(file instanceof File) || !file.size || !screenshotTypes.includes(file.type)) throw new UserError('Paste a PNG, JPEG, GIF or WebP screenshot.', 400);
    if (file.size > MAX_SCREENSHOT_BYTES) throw new UserError('Screenshots must be 10 MB or smaller.', 400);
    return { file, repo };
  })
  .handler(({ data }) => upload(data.repo, data.file));

export const readScreenshot = createServerFn({ method: 'GET' })
  .validator((input: { url: string }) => {
    const { url } = fields(input);
    if (typeof url !== 'string' || url.length > 2000 || !isGithubScreenshot(url)) throw new UserError('Invalid GitHub screenshot URL.', 400);
    return url;
  })
  .handler(({ data }) => read(data));
