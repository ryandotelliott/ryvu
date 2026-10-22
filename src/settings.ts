import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseRepo, UserError } from './domain.js';
import type { Settings } from './types.js';
export const MAX_REPOS = 30;
export const defaultSettings: Settings = { repos: [], pageSize: 25, showDrafts: true, showBots: true };
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UserError('Invalid settings.', 400);
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.repos) || raw.repos.length > MAX_REPOS) throw new UserError(`Add at most ${MAX_REPOS} repositories.`, 400);
  const repos = raw.repos.map(parseRepo);
  if (new Set(repos.map(repo => repo.toLowerCase())).size !== repos.length) throw new UserError('Each repository can only be added once.', 400);
  if (![10, 25, 50].includes(raw.pageSize as number) || typeof raw.showDrafts !== 'boolean' || typeof raw.showBots !== 'boolean') throw new UserError('Invalid home page settings.', 400);
  return { repos, pageSize: raw.pageSize as Settings['pageSize'], showDrafts: raw.showDrafts, showBots: raw.showBots };
}
export class SettingsStore {
  private current: Settings | null = null;
  constructor(private path: string) {}
  get(): Settings {
    if (!this.current) {
      try { this.current = validateSettings(JSON.parse(readFileSync(this.path, 'utf8'))); } catch { this.current = { ...defaultSettings }; }
    }
    return this.current;
  }
  save(value: unknown): Settings {
    const settings = validateSettings(value);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 }); chmodSync(dirname(this.path), 0o700);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 }); renameSync(temporary, this.path); } finally { try { unlinkSync(temporary); } catch { /* already renamed */ } }
    this.current = settings; return settings;
  }
}
