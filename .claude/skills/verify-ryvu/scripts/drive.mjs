#!/usr/bin/env node
// Runs one journey against the instance launch.sh started and saves evidence.
//   node .claude/skills/verify-ryvu/scripts/drive.mjs <journey> [--dark] [--headed]
// <journey> is a file in ../journeys (with or without .mjs). Evidence goes to .verify/evidence/<time>-<journey>/:
// numbered screenshots, transcript.md (every step and check) and result.json. Exit code 0 means every check passed.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = execFileSync('git', ['-C', skill, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const args = process.argv.slice(2), name = args.find(arg => !arg.startsWith('--'))?.replace(/\.mjs$/, '');
if (!name) { console.error('usage: drive.mjs <journey> [--dark] [--headed]'); process.exit(2); }
const journeyPath = join(skill, 'journeys', `${name}.mjs`);
if (!existsSync(journeyPath)) { console.error(`no journey at ${journeyPath}`); process.exit(2); }
const instancePath = join(root, '.verify', 'instance.json');
if (!existsSync(instancePath)) { console.error('no instance; run scripts/launch.sh first'); process.exit(2); }
const instance = JSON.parse(readFileSync(instancePath, 'utf8'));
const harness = join(skill, '.harness', 'package.json');
if (!existsSync(harness)) { console.error('browser harness missing; run scripts/setup.sh'); process.exit(2); }
const { chromium } = createRequire(harness)('playwright');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(root, '.verify', 'evidence', `${stamp}-${name}`); mkdirSync(out, { recursive: true });
const transcript = join(out, 'transcript.md');
writeFileSync(transcript, `# ${name}\n\n${instance.url} (${instance.mode}) · ${new Date().toISOString()}\n\n`);
const log = line => { appendFileSync(transcript, `${line}\n`); console.log(line); };

const browser = await chromium.launch({ headless: !args.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: args.includes('--dark') ? 'dark' : 'light' });
const pageErrors = [], consoleErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

let shots = 0, checks = 0;
const ctx = {
  page, base: instance.url, out, instance,
  // Open an app route such as '/', '/settings' or '/pr/owner/repo/123/diff'.
  async go(path) { log(`- open \`${path}\``); await page.goto(instance.url + path); },
  async shot(label) { const file = `${String(++shots).padStart(2, '0')}-${label}.png`; await page.screenshot({ path: join(out, file) }); log(`- screenshot \`${file}\``); return file; },
  note: text => log(`- ${text}`),
  // A failed check stops the journey and fails the run.
  check(condition, message) { checks++; if (!condition) throw new Error(`check failed: ${message}`); log(`- ✓ ${message}`); },
  async inbox() {
    await ctx.go('/');
    await page.waitForSelector('a.pull-row:not(.skeleton)', { timeout: 60_000 });
    return page.locator('a.pull-row:not(.skeleton)').evaluateAll(rows => rows.map(row => {
      const path = new URL(row.href).pathname, [, owner, repo, number] = path.match(/^\/pr\/([^/]+)\/([^/]+)\/(\d+)$/) ?? [];
      const count = selector => Number(row.querySelector(selector)?.textContent.replace(/\D/g, '') || 0);
      return { repo: `${owner}/${repo}`, number: Number(number), title: row.querySelector('.pull-title')?.textContent.trim() ?? '', additions: count('.diffstat .added'), deletions: count('.diffstat .removed'), path };
    }));
  },
  github(route) {
    if (!/^repos\/[\w.-]+\/[\w.-]+\/[\w./?=&-]+$/.test(route)) throw new Error(`refusing to read ${route}`);
    return JSON.parse(execFileSync('gh', ['api', route, '--paginate', '--slurp'], { encoding: 'utf8', maxBuffer: 50_000_000 })).flat();
  },
  githubQuery(query, variables) {
    if (!/^\s*query\b/.test(query)) throw new Error('only GraphQL queries are allowed');
    const args = ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${query}`, ...Object.entries(variables).flatMap(([key, value]) => [typeof value === 'number' ? '-F' : '-f', `${key}=${value}`])];
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 50_000_000 }));
  },
  // Waits until a diff has actually drawn code rows (the diff renderer is virtualized and lives in shadow DOM).
  async waitForDiffRows(timeout = 60_000) {
    await page.waitForSelector('.diff-card.expanded diffs-container', { timeout });
    await page.waitForFunction(() => [...document.querySelectorAll('.diff-card.expanded diffs-container')].some(c => c.shadowRoot?.querySelector('[data-line]')), null, { timeout });
  },
  // Rows drawn in diff cards that are on screen right now.
  visibleRows: () => page.evaluate(() => [...document.querySelectorAll('.diff-card.expanded diffs-container')].filter(c => { const b = c.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; }).reduce((n, c) => n + (c.shadowRoot?.querySelectorAll('[data-line]').length ?? 0), 0)),
};

const started = Date.now();
let status = 'pass', error = null;
try {
  await page.goto(instance.url + '/');
  const journey = (await import(pathToFileURL(journeyPath).href)).default;
  await journey(ctx);
  ctx.check(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`);
  const blocked = consoleErrors.filter(text => text.includes('Content Security Policy'));
  ctx.check(blocked.length === 0, `no Content-Security-Policy violations${blocked.length ? `: ${blocked.join(' | ')}` : ''}`);
} catch (e) {
  status = 'fail'; error = e instanceof Error ? e.message : String(e);
  log(`- ✗ ${error}`);
  await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
} finally {
  await browser.close();
}
const result = { journey: name, status, error, checks, screenshots: shots, pageErrors, consoleErrors, url: instance.url, mode: instance.mode, durationMs: Date.now() - started, evidence: out };
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
log(`\n**${status.toUpperCase()}** · ${checks} checks · evidence in ${out}`);
process.exit(status === 'pass' ? 0 : 1);
