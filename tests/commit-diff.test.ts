import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchCommit } from '../src/adapters.js';
import type { Runner } from '../src/process.js';

const identity = { owner: 'owner', repo: 'repo', number: 1, url: 'https://github.com/owner/repo/pull/1' };
const sha = 'a'.repeat(40), parent = 'b'.repeat(40);
const metadata = { sha, parents: [{ sha: parent }, { sha: 'c'.repeat(40) }], author: { login: 'author' }, commit: { message: 'Change a file\n\nDetails', committer: { date: '2026-11-10T12:00:00Z' } } };
const signal = new AbortController().signal;

test('commit diffs use the first parent and retain renames from later file pages', async () => {
  const runner: Runner = async (command, args) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', `repos/owner/repo/commits/${sha}?per_page=100`, '--paginate', '--slurp']);
    return JSON.stringify([
      { ...metadata, files: [{ filename: 'added.txt', status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+new' }] },
      { ...metadata, files: [{ filename: 'renamed.txt', previous_filename: 'old.txt', status: 'renamed', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' }] }
    ]);
  };
  const diff = await fetchCommit(identity, sha, signal, runner);
  assert.equal(diff.baseSHA, parent);
  assert.equal(diff.commit.sha, sha);
  assert.equal(diff.commit.message, 'Change a file');
  assert.deepEqual(diff.files.map(file => [file.path, file.previousPath]), [['added.txt', null], ['renamed.txt', 'old.txt']]);
  assert.deepEqual(diff.files[1].lines.map(line => line.kind), ['remove', 'add']);
});

test('root commits use the empty tree and empty commits remain readable', async () => {
  const diff = await fetchCommit(identity, sha, signal, async () => JSON.stringify([{ ...metadata, parents: [], files: [] }]));
  assert.equal(diff.baseSHA, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  assert.deepEqual(diff.files, []);
});

test('invalid SHAs never reach GitHub and mismatched file pages are rejected', async () => {
  await assert.rejects(fetchCommit(identity, '../main', signal, async () => { throw new Error('must not run'); }), /Invalid commit/);
  await assert.rejects(fetchCommit(identity, sha, signal, async () => JSON.stringify([{ ...metadata, files: [] }, { ...metadata, sha: parent, files: [] }])), /invalid commit file pages/);
});
