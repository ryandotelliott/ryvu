// Fuzzy matching for the command palette and the outline filter. Every query token
// must match one field, either as a substring or as a reasonably tight subsequence.
export type FieldMatch = number[];
type TokenMatch = { score: number; positions: number[] };
const boundary = (text: string, index: number) => index === 0 || /[\s/_\-.:#()[\]]/.test(text[index - 1]) || (/[a-z]/.test(text[index - 1]) && /[A-Z]/.test(text[index]));

function matchToken(token: string, text: string): TokenMatch | null {
  const lower = text.toLowerCase();
  let best: TokenMatch | null = null;
  for (let index = lower.indexOf(token); index !== -1; index = lower.indexOf(token, index + 1)) {
    const score = 100 + token.length * 6 + (boundary(text, index) ? 40 : 0) - index * 0.05;
    if (!best || score > best.score) best = { score, positions: Array.from({ length: token.length }, (_, i) => index + i) };
  }
  if (best || token.length < 2) return best;
  for (let start = lower.indexOf(token[0]); start !== -1; start = lower.indexOf(token[0], start + 1)) {
    const positions = [start];
    for (let i = 1, from = start + 1; i < token.length; i++) {
      const next = lower.indexOf(token[i], from);
      if (next === -1) break;
      positions.push(next); from = next + 1;
    }
    if (positions.length !== token.length) break;
    const span = positions[positions.length - 1] - start + 1;
    if (span > token.length + Math.max(3, Math.ceil(token.length * 0.75))) continue;
    let score = token.length * 8 - (span - token.length) * 3;
    positions.forEach((position, i) => { if (boundary(text, position)) score += 12; if (i && positions[i - 1] === position - 1) score += 6; });
    if (!best || score > best.score) best = { score, positions };
  }
  return best;
}

// Returns null when the query doesn't match; otherwise a score and the matched character positions per field.
export function fuzzy(query: string, fields: string[], weights: number[] = []): { score: number; fields: FieldMatch[] } | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { score: 0, fields: fields.map(() => []) };
  const matched = fields.map(() => new Set<number>());
  let total = 0;
  for (const token of tokens) {
    let best: { field: number; match: TokenMatch } | null = null;
    fields.forEach((field, i) => {
      const match = matchToken(token, field);
      if (match && (!best || match.score * (weights[i] ?? 1) > best.match.score * (weights[best.field] ?? 1))) best = { field: i, match };
    });
    if (!best) return null;
    const { field, match } = best as { field: number; match: TokenMatch };
    total += match.score * (weights[field] ?? 1);
    for (const position of match.positions) matched[field].add(position);
  }
  return { score: total, fields: matched.map(set => [...set].sort((a, b) => a - b)) };
}

// Plain substring filter: every whitespace-separated token must appear in the text.
export function contains(query: string, text: string): boolean {
  const lower = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(token => lower.includes(token));
}

// Splits text into plain and highlighted runs.
export function segments(text: string, positions: number[] = []): { text: string; hit: boolean }[] {
  if (!positions.length) return [{ text, hit: false }];
  const hits = new Set(positions), runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i), last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i]; else runs.push({ text: text[i], hit });
  }
  return runs;
}
