import { useRef, useState, type ClipboardEvent, type Dispatch, type SetStateAction } from 'react';
import { uploadScreenshot } from '../screenshots.functions';
import { MAX_SCREENSHOT_BYTES, screenshotTypes } from '../screenshots';
import { useReview } from './pull-page';

export const withoutPendingScreenshots = (body: string) => body.replace(/!\[Uploading screenshot…\]\(attachment:[a-f0-9-]{36}\)/g, '');

export function useScreenshotPaste(setBody: Dispatch<SetStateAction<string>>) {
  const review = useReview(), [pending, setPending] = useState(0), [error, setError] = useState('');
  const active = useRef(0);
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(file => file !== null);
    if (!files.length) return;
    event.preventDefault();
    setError('');
    if (!review) { setError('Open a pull request before attaching a screenshot.'); return; }
    if (files.some(file => !screenshotTypes.includes(file.type))) { setError('Paste a PNG, JPEG, GIF or WebP screenshot.'); return; }
    if (files.some(file => !file.size || file.size > MAX_SCREENSHOT_BYTES)) { setError('Screenshots must be 10 MB or smaller.'); return; }
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    const markers = files.map(() => `![Uploading screenshot…](attachment:${crypto.randomUUID()})`);
    setBody(body => body.slice(0, start) + markers.join('\n') + body.slice(end));
    active.current += files.length;
    setPending(active.current);
    files.forEach((file, index) => {
      const data = new FormData(); data.set('repo', review.repo); data.set('file', file);
      void uploadScreenshot({ data }).then(
        url => setBody(body => body.replace(markers[index], `![Screenshot](${url})`)),
        failure => { setBody(body => body.replace(markers[index], '')); setError(failure instanceof Error ? failure.message : 'The screenshot upload failed. Paste again to retry.'); }
      ).finally(() => { active.current--; setPending(active.current); });
    });
  }
  return { onPaste, uploading: pending > 0, isUploading: () => active.current > 0, error };
}
