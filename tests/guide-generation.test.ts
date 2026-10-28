import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateGuide } from '../src/adapters.js';
import { normalizeFile, validateGuide, validateReference } from '../src/domain.js';
import { guideGeneration } from '../src/guide-generation.js';
import { ReviewService, type Dependencies } from '../src/service.js';
import { Store } from '../src/store.js';
import type { Runner } from '../src/process.js';
import type { Guide, Snapshot } from '../src/types.js';

const file = normalizeFile({ filename: 'internal/auth/auth.go', status: 'modified', additions: 2, deletions: 2, patch: '@@ -1032,2 +1032,2 @@\n-before\n+after\n context\n@@ -1041 +1041 @@\n-old\n+new' });
const snapshot: Snapshot = {
  identity: { owner: 'owner', repo: 'repo', number: 1, url: 'https://github.com/owner/repo/pull/1' },
  title: 'Change authentication', body: '', author: 'author', baseSHA: 'a'.repeat(40), headSHA: 'b'.repeat(40), fetchedAt: '2026-10-28T00:00:00Z', warnings: [], files: [file]
};
const candidate: Guide = {
  summary: 'Update authentication behavior.', omissions: [], limitations: [],
  chapters: [{ id: 'authentication', title: 'Authentication', purpose: 'Update the checks.', behavior: 'The checks now use the updated values.', questions: ['Are the new checks correct?'], files: [file.path], references: [{ path: file.path, side: 'new', startLine: 1032, endLine: 1041 }] }]
};

// An external generator can obey its schema while returning an invalid range.
// When the schema offers evidence IDs instead, it chooses one of those IDs.
const schemaFollowingModel: Runner = async (command, args) => {
  assert.equal(command, 'codex');
  const schema = JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1], 'utf8'));
  const item = schema.properties.chapters.items.properties.references.items;
  const references = item.type === 'integer' ? [item.minimum] : candidate.chapters[0].references;
  await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ ...candidate, chapters: [{ ...candidate.chapters[0], files: schema.properties.chapters.items.properties.files.items.type === 'integer' ? [1] : candidate.chapters[0].files, references }] }));
  return '';
};

test('analysis completes without model-authored ranges crossing a gap between hunks', async () => {
  const guide = await generateGuide(snapshot, new AbortController().signal, [], schemaFollowingModel);
  assert.equal(validateGuide(guide, snapshot), guide);
  assert.ok(guide.chapters[0].references.length > 0);
  for (const reference of guide.chapters[0].references) validateReference(reference, file);
});

test('validation continues rejecting the reported range rather than weakening evidence checks', () => {
  assert.throws(() => validateGuide(candidate, snapshot), /internal\/auth\/auth.go new:1032-1041 does not identify a contiguous changed hunk/);
});

function response(references: number[], files: number[], omissions: { fileId: number; reason: string }[] = []) {
  return { ...candidate, omissions, chapters: [{ ...candidate.chapters[0], files, references }] };
}

test('every offered reference stays in one hunk and covers changes on its own side', () => {
  const large = normalizeFile({ filename: 'renamed/auth.go', previous_filename: 'old/auth.go', status: 'renamed', additions: 251, deletions: 1, patch: `@@ -0,0 +1,250 @@\n${Array.from({ length: 250 }, (_, i) => `+line ${i}`).join('\n')}\n@@ -500,2 +750,2 @@\n-old\n+new\n context` });
  const current = { ...snapshot, files: [large] }, generation = guideGeneration(current);
  const maximum = generation.schema.properties.chapters.items.properties.references.items.maximum;
  assert.ok(typeof maximum === 'number');
  const guide = generation.parse(response(Array.from({ length: maximum }, (_, i) => i + 1), [1]));
  const references = guide.chapters[0].references;
  for (const reference of references) {
    assert.equal(reference.path, large.path);
    validateReference(reference, large);
    assert.ok(reference.endLine - reference.startLine <= 100);
  }
  for (const line of large.lines.filter(line => line.kind !== 'context')) {
    const side = line.kind === 'add' ? 'new' : 'old', number = side === 'new' ? line.newLine : line.oldLine;
    assert.ok(number !== null && references.some(ref => ref.side === side && ref.startLine <= number && ref.endLine >= number));
  }
});

test('context-only sides are not offered as evidence', () => {
  const added = normalizeFile({ filename: 'added.go', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1,2 +1,3 @@\n before\n+new\n after' });
  const generation = guideGeneration({ ...snapshot, files: [added] });
  assert.equal(generation.schema.properties.chapters.items.properties.references.items.maximum, 1);
  const guide = generation.parse(response([1], [1]));
  assert.equal(guide.chapters[0].references[0].side, 'new');
});

test('metadata-only files allow empty references and keep their omission requirements', () => {
  const renamed = normalizeFile({ filename: 'renamed.go', previous_filename: 'old.go', status: 'renamed', additions: 0, deletions: 0 });
  const generation = guideGeneration({ ...snapshot, files: [renamed] });
  assert.equal(generation.schema.properties.chapters.items.properties.references.maxItems, 0);
  assert.throws(() => generation.parse(response([], [1])), /missing limitation/);
  const guide = generation.parse(response([], [1], [{ fileId: 1, reason: 'Rename only; no patch is available.' }]));
  assert.deepEqual(guide.chapters[0].references, []);
});

test('unknown IDs, coordinate objects and references outside a chapter are still rejected', () => {
  const generation = guideGeneration(snapshot);
  assert.throws(() => generation.parse(response([999], [1])), /unknown evidence reference ID/);
  assert.throws(() => generation.parse(response([1], [999])), /unknown file ID/);
  assert.throws(() => generation.parse(candidate), /unknown evidence reference ID/);
  const other = { ...file, path: 'other.go' }, twoFiles = guideGeneration({ ...snapshot, files: [file, other] });
  assert.throws(() => twoFiles.parse(response([1], [2])), /outside the chapter/);
});

test('analysis saves concrete references and existing cached guides remain readable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ryvu-guide-test-')), store = new Store(join(directory, 'test.db'));
  const deps: Dependencies = {
    fetch: async () => snapshot,
    generate: (snapshot, signal, ignored) => generateGuide(snapshot, signal, ignored, schemaFollowingModel),
    conversation: async () => ({ threads: [], reviews: [], comments: [] }), status: async () => { throw new Error('not used'); }, stack: async () => null,
    compare: async () => { throw new Error('not used'); }
  };
  try {
    const service = new ReviewService(store, deps);
    const result = await service.review(snapshot.identity.url, new AbortController().signal, () => {}, true);
    const cached = service.cached(snapshot);
    assert.ok(cached);
    assert.equal(cached.cached, true);
    assert.deepEqual(cached.guide, result.guide);
    assert.ok(cached.guide.chapters[0].references.every(ref => typeof ref === 'object' && ref.path === file.path));
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
