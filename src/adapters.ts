import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guidePrompt, guideSchema, MODEL, normalizeFile, UserError, validateGuide } from './domain.js';
import { runCommand, type Runner } from './process.js';
import type { ChangedFile, Guide, PRIdentity, Snapshot } from './types.js';
function metadata(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object') throw new UserError('GitHub returned invalid PR metadata.');
  const d = value as Record<string, any>;
  if (!/^[a-f0-9]{40}$/.test(d.base?.sha ?? '') || !/^[a-f0-9]{40}$/.test(d.head?.sha ?? '') || typeof d.title !== 'string') throw new UserError('GitHub did not return valid base and head commits.');
  return d;
}
export async function fetchSnapshot(identity: PRIdentity, signal: AbortSignal, runner: Runner = runCommand): Promise<Snapshot> {
  const route = `repos/${identity.owner}/${identity.repo}/pulls/${identity.number}`;
  const call = async (args: string[]) => JSON.parse(await runner('gh', ['api', ...args], { signal, maxBytes: 5_000_000 }));
  const first = metadata(await call([route]));
  const pages: unknown = await call([`${route}/files?per_page=100`, '--paginate', '--slurp']);
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new UserError('GitHub returned invalid file pages.');
  const files = (pages as Record<string, unknown>[][]).flat().map(normalizeFile);
  const last = metadata(await call([route]));
  if (first.head.sha !== last.head.sha || first.base.sha !== last.base.sha) throw new UserError('The PR changed while its diff was loading. Retry to read a consistent snapshot.');
  if (Number.isInteger(last.changed_files) && files.length !== last.changed_files) throw new UserError('GitHub did not return every changed file; the PR may exceed GitHub’s file limit.');
  if (new Set(files.map(f => f.path)).size !== files.length) throw new UserError('GitHub returned duplicate file paths.');
  const body = String(last.body ?? '');
  const warnings = files.filter(f => f.availability !== 'complete').map(f => `${f.path}: ${f.availability === 'partial' ? 'partial patch; conclusions cover only visible lines' : 'patch unavailable (binary, rename-only, or GitHub omission)'}.`);
  if (body.length > 8000) warnings.push('PR description shortened to 8,000 characters.');
  const state = last.merged_at ? 'merged' : last.state === 'closed' ? 'closed' : 'open';
  const snapshot: Snapshot = { identity, title: last.title.slice(0, 500), body: body.slice(0, 8000), author: String(last.user?.login ?? 'unknown'), baseSHA: last.base.sha, headSHA: last.head.sha, fetchedAt: new Date().toISOString(), warnings, files, headRef: String(last.head?.ref ?? ''), baseRef: String(last.base?.ref ?? ''), state, draft: Boolean(last.draft), createdAt: String(last.created_at ?? '') };
  signal.throwIfAborted(); return snapshot;
}
// The changes from base to head as GitHub's compare view shows them, measured from the commits' merge base. GitHub lists at most 300 files. Read-only.
export async function compareCommits(owner: string, repo: string, base: string, head: string, signal: AbortSignal, runner: Runner = runCommand): Promise<{ baseSHA: string; files: ChangedFile[] }> {
  if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw new UserError('Invalid commits to compare.', 400);
  // The files come with the first page of commits, so one commit per page keeps the response small.
  const value = JSON.parse(await runner('gh', ['api', `repos/${owner}/${repo}/compare/${base}...${head}?per_page=1`], { signal, maxBytes: 20_000_000 }));
  const baseSHA = value?.merge_base_commit?.sha, files: unknown = value?.files ?? [];
  if (typeof baseSHA !== 'string' || !/^[a-f0-9]{40}$/.test(baseSHA) || !Array.isArray(files)) throw new UserError('GitHub returned an invalid comparison.');
  signal.throwIfAborted(); return { baseSHA, files: files.map(normalizeFile) };
}
// A range of stacked PRs must show every changed file, so it can't use a comparison GitHub cut short.
export async function fetchCompare(identity: PRIdentity, base: string, head: string, signal: AbortSignal, runner: Runner = runCommand): Promise<{ baseSHA: string; files: ChangedFile[] }> {
  const diff = await compareCommits(identity.owner, identity.repo, base, head, signal, runner);
  if (diff.files.length >= 300) throw new UserError('Together these pull requests change more than 300 files, more than GitHub can compare at once. Review fewer of them together.');
  return diff;
}
// The model only receives supplied data: user config, hooks, connectors, browser,
// shell, code mode, agents, memory and image tools are disabled for this process.
export function codexArgs(cwd: string, schemaPath: string, outputPath: string): string[] {
  const disabled = ['shell_tool', 'unified_exec', 'code_mode', 'code_mode_host', 'apps', 'plugins', 'remote_plugin', 'hooks', 'multi_agent', 'multi_agent_v2', 'memories', 'chronicle', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'image_generation', 'view_image', 'skill_search', 'shell_snapshot', 'workspace_dependencies', 'goals'];
  return ['-a', 'never', 'exec', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--model', MODEL, '-c', 'model_reasoning_effort="high"', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', ...disabled.flatMap(flag => ['--disable', flag]), '--cd', cwd, '--output-schema', schemaPath, '--output-last-message', outputPath, '-'];
}
export async function generateGuide(snapshot: Snapshot, signal: AbortSignal, ignored: readonly string[] = [], runner: Runner = runCommand): Promise<Guide> {
  const directory = await mkdtemp(join(tmpdir(), 'pr-guide-'));
  try {
    const schema = join(directory, 'schema.json'), output = join(directory, 'guide.json');
    await writeFile(schema, JSON.stringify(guideSchema), { mode: 0o600 }); signal.throwIfAborted();
    await runner('codex', codexArgs(directory, schema, output), { signal, cwd: directory, input: guidePrompt(snapshot, ignored), timeoutMs: 8 * 60_000, maxBytes: 2_000_000 });
    signal.throwIfAborted();
    let value: unknown;
    try { value = JSON.parse(await readFile(output, 'utf8')); } catch { throw new UserError('Codex did not return a complete JSON guide. Retry; no result was cached.'); }
    return validateGuide(value, snapshot);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
