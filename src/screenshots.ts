export const MAX_SCREENSHOT_BYTES = 10_000_000;
export const screenshotTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function isGithubScreenshot(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && /^\/user-attachments\/assets\/[a-f0-9-]{36}$/i.test(url.pathname);
  } catch { return false; }
}
