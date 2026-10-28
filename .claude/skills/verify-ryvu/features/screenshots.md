# Screenshots

PR descriptions and comments render Markdown images and sanitized HTML image tags. Pasting a screenshot into a comment, reply, or review summary uploads it to GitHub and inserts a Markdown URL. Private GitHub attachments load through the existing gh sign-in.

## Sub-features

- Markdown and HTML images fit their container, including diff annotations.
- Clipboard uploads preserve surrounding text and edits made during the upload.
- Submit waits until uploads finish. Ordinary text paste still works.
- PNG, JPEG, GIF and WebP images up to 10 MB are supported. Uploads require repository write access.
- Saved drafts retain GitHub URLs across reloads. Pending upload placeholders are not persisted in review summaries.
- Unsupported files and failed uploads show an error without discarding the comment.

## How to get to it (user POV)

Open a PR's Overview to read screenshots in its description or activity. On Diff, add a comment or reply to a thread, then paste a screenshot with Cmd+V or Ctrl+V. The Review menu also accepts screenshot paste in its summary.

## Driving it with Playwright

Preconditions:

- Set `VERIFY_SCREENSHOT_PR=owner/repo/number` to a PR containing screenshots in its description.
- Set `VERIFY_UPLOAD_PR=owner/repo/number` to a PR in a repository where you have write access.
- Run `drive.mjs screenshots` in both themes and against the production server to cover its Content Security Policy.

The journey uploads a generated test image to GitHub. It verifies rendering, clipboard paste, concurrent typing, local draft persistence, sanitized HTML, inline comment sizing, and error handling. It deletes its local draft without submitting a GitHub comment or review.

## Gotchas

- The generated image asset remains on GitHub after the test. No PR description or conversation is changed.
- A browser's GitHub cookies are not required for private attachments. The local server authenticates GitHub requests and follows signed CDN redirects without forwarding credentials.
- Screenshot upload does not require upgrading the installed gh CLI. The app uses the same authenticated upload endpoint as the CLI's attach feature.
