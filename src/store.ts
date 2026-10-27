import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MODEL, PROMPT_VERSION, UserError } from './domain.js';
import type { DiffSide, DraftComment, PriorGuide, Review } from './types.js';

type GuideRow = { review: string };
// A comment on the whole file is stored with line 0, since the column predates file comments and can't be null.
type DraftRow = { id: string; path: string; side: string; start_line: number | null; line: number; body: string; head_sha: string; created_at: string };
const draftFromRow = (row: DraftRow): DraftComment => ({ id: row.id, path: row.path, side: row.side === 'deletions' ? 'deletions' : 'additions', startLine: row.start_line, line: row.line || null, body: row.body, headSHA: row.head_sha, createdAt: row.created_at });

// Local SQLite store for analyzed guides (keyed by head commit) and pending review comments.
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); chmodSync(dirname(path), 0o700);
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS guides (
        repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL, base_sha TEXT NOT NULL,
        model TEXT NOT NULL, prompt_version TEXT NOT NULL, key TEXT NOT NULL, chapters INTEGER NOT NULL,
        review TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (repo, number, head_sha, model, prompt_version)
      );
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY, repo TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
        path TEXT NOT NULL, side TEXT NOT NULL, start_line INTEGER, line INTEGER NOT NULL,
        body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS drafts_by_pull ON drafts (repo, number);
    `);
  }
  // Guides from the earlier file cache are imported once; existing rows are kept.
  importFileCache(directory: string): void {
    if (!existsSync(directory)) return;
    for (const name of readdirSync(directory).filter(name => name.endsWith('.json'))) {
      try { const review = JSON.parse(readFileSync(join(directory, name), 'utf8')) as Review; if (review?.snapshot?.headSHA && review.model) this.saveGuide(review, review.generatedAt, true); } catch { /* skip unreadable cache files */ }
    }
  }
  saveGuide(review: Review, createdAt = new Date().toISOString(), keepExisting = false): void {
    const { owner, repo, number } = review.snapshot.identity;
    this.db.prepare(`INSERT ${keepExisting ? 'OR IGNORE' : 'OR REPLACE'} INTO guides (repo, number, head_sha, base_sha, model, prompt_version, key, chapters, review, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`${owner}/${repo}`.toLowerCase(), number, review.snapshot.headSHA, review.snapshot.baseSHA, review.model, PROMPT_VERSION, review.key, review.guide.chapters.length, JSON.stringify({ ...review, cached: false }), createdAt);
  }
  guide(repo: string, number: number, headSHA: string): Review | null {
    const row = this.db.prepare('SELECT review FROM guides WHERE repo = ? AND number = ? AND head_sha = ? AND model = ? AND prompt_version = ?').get(repo.toLowerCase(), number, headSHA, MODEL, PROMPT_VERSION) as GuideRow | undefined;
    if (!row) return null;
    try { return JSON.parse(row.review) as Review; } catch { return null; }
  }
  guideStatus(repo: string, number: number, headSHA: string): { key: string; chapters: number } | null {
    const row = this.db.prepare('SELECT key, chapters FROM guides WHERE repo = ? AND number = ? AND head_sha = ? AND model = ? AND prompt_version = ?').get(repo.toLowerCase(), number, headSHA, MODEL, PROMPT_VERSION) as { key: string; chapters: number } | undefined;
    return row ? { key: row.key, chapters: row.chapters } : null;
  }
  // Analyzed PRs in these repositories, newest first, for the "Guide ready" list.
  guidedPulls(repos: string[], limit = 100): { repo: string; number: number; headSHA: string }[] {
    if (!repos.length) return [];
    const rows = this.db.prepare(`SELECT repo, number, head_sha FROM guides WHERE model = ? AND prompt_version = ? AND repo IN (${repos.map(() => '?').join(', ')}) ORDER BY created_at DESC LIMIT ?`)
      .all(MODEL, PROMPT_VERSION, ...repos.map(repo => repo.toLowerCase()), limit) as { repo: string; number: number; head_sha: string }[];
    return rows.map(row => ({ repo: row.repo, number: row.number, headSHA: row.head_sha }));
  }
  // The most recent guide for an earlier commit, so the UI can say the PR changed since it was analyzed.
  priorGuide(repo: string, number: number, headSHA: string): PriorGuide | null {
    const row = this.db.prepare('SELECT head_sha, created_at FROM guides WHERE repo = ? AND number = ? AND head_sha != ? ORDER BY created_at DESC LIMIT 1').get(repo.toLowerCase(), number, headSHA) as { head_sha: string; created_at: string } | undefined;
    return row ? { headSHA: row.head_sha, generatedAt: row.created_at } : null;
  }
  drafts(repo: string, number: number): DraftComment[] {
    return (this.db.prepare('SELECT id, path, side, start_line, line, body, head_sha, created_at FROM drafts WHERE repo = ? AND number = ? ORDER BY created_at').all(repo.toLowerCase(), number) as DraftRow[]).map(draftFromRow);
  }
  addDraft(repo: string, number: number, draft: { headSHA: string; path: string; side: DiffSide; startLine: number | null; line: number | null; body: string }): DraftComment {
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare('INSERT INTO drafts (id, repo, number, head_sha, path, side, start_line, line, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, repo.toLowerCase(), number, draft.headSHA, draft.path, draft.side, draft.startLine, draft.line ?? 0, draft.body, now, now);
    return { id, ...draft, createdAt: now };
  }
  updateDraft(id: string, body: string): DraftComment {
    const result = this.db.prepare('UPDATE drafts SET body = ?, updated_at = ? WHERE id = ?').run(body, new Date().toISOString(), id);
    if (!result.changes) throw new UserError('That pending comment no longer exists.', 404);
    return draftFromRow(this.db.prepare('SELECT id, path, side, start_line, line, body, head_sha, created_at FROM drafts WHERE id = ?').get(id) as DraftRow);
  }
  deleteDraft(id: string): void { this.db.prepare('DELETE FROM drafts WHERE id = ?').run(id); }
  clearDrafts(repo: string, number: number, ids: string[]): void {
    const remove = this.db.prepare('DELETE FROM drafts WHERE repo = ? AND number = ? AND id = ?');
    for (const id of ids) remove.run(repo.toLowerCase(), number, id);
  }
  close(): void { this.db.close(); }
}
