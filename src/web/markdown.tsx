import { Fragment, type ReactNode } from 'react';

// A small GitHub-flavored Markdown subset rendered as React elements (never raw HTML),
// enough for PR descriptions and review comments. Only http(s) links are linked.
const INLINE = /(`+)([\s\S]*?)\1|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|(?<![\w*])\*(?!\s)([^*]+?)\*(?![\w*])|(?<![\w_])_(?!\s)([^_]+?)_(?![\w_])|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_])/g;
const safeUrl = (url: string) => /^https?:\/\//i.test(url) ? url : null;
function link(url: string, label: ReactNode, key: number) {
  const href = safeUrl(url);
  return href ? <a key={key} href={href} target="_blank" rel="noreferrer">{label}</a> : <span key={key}>{label}</span>;
}
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, key = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const [whole, , code, imageAlt, imageUrl, linkText, linkUrl, bold, bold2, strike, em, em2, angled, bare] = match;
    if (code !== undefined) out.push(<code key={key++}>{code}</code>);
    else if (imageUrl !== undefined) out.push(link(imageUrl, `[image${imageAlt ? `: ${imageAlt}` : ''}]`, key++));
    else if (linkUrl !== undefined) out.push(link(linkUrl, inline(linkText), key++));
    else if (bold ?? bold2) out.push(<strong key={key++}>{inline(bold ?? bold2)}</strong>);
    else if (strike) out.push(<del key={key++}>{inline(strike)}</del>);
    else if (em ?? em2) out.push(<em key={key++}>{inline(em ?? em2)}</em>);
    else out.push(link(angled ?? bare, angled ?? bare, key++));
    last = match.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
// GitHub renders inline HTML; here known tags are dropped and their text kept.
const HTML_TAG = /<\/?(?:a|img|picture|source|details|summary|br|sub|sup|p|div|span|b|i|u|strong|em|kbd|table|thead|tbody|tr|td|th|h[1-6]|ul|ol|li|hr|code|pre|blockquote|del|ins|samp|video|relative-time)\b[^<>]*\/?>/gi;
const withBreaks = (lines: string[]) => lines.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{inline(line)}</Fragment>);

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  let fenced = false;
  const lines = text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n').map(line => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) fenced = !fenced;
    // Link reference definitions ([id]: url) never render on GitHub; bots use them to stash metadata.
    return fenced || /^\s*(`{3,}|~{3,})/.test(line) ? line : /^ {0,3}\[[^\]]+\]:\s*\S/.test(line) ? '' : line.replace(HTML_TAG, '');
  }), blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const body: string[] = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      // diff fences color their added and removed lines, as GitHub does.
      const diff = line.trim().slice(fence[1].length).trim().toLowerCase() === 'diff';
      blocks.push(<pre key={blocks.length}><code>{diff ? body.map((text, n) => <span key={n} className={/^\+/.test(text) ? 'md-add' : /^-/.test(text) ? 'md-del' : undefined}>{text}{'\n'}</span>) : body.join('\n')}</code></pre>); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { blocks.push(<p key={blocks.length} className={`md-heading md-h${Math.min(heading[1].length, 4)}`}>{inline(heading[2].replace(/\s#+\s*$/, ''))}</p>); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={blocks.length} />); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++].trim());
      const cells = (row: string) => row.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
      const headed = rows.length > 1 && /^\|[\s:|-]+\|$/.test(rows[1]), head = headed ? cells(rows[0]) : null, body = (headed ? rows.slice(2) : rows).map(cells);
      blocks.push(<div key={blocks.length} className="md-table"><table>{head && <thead><tr>{head.map((cell, n) => <th key={n}>{inline(cell)}</th>)}</tr></thead>}<tbody>{body.map((row, r) => <tr key={r}>{row.map((cell, n) => <td key={n}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={blocks.length}><Markdown text={quote.join('\n')} /></blockquote>); continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    if (item.test(line)) {
      const ordered = /\d/.test(line.match(item)![2]), entries: { text: string[]; depth: number }[] = [];
      while (i < lines.length && (item.test(lines[i]) || (lines[i].trim() && /^\s{2,}/.test(lines[i]) && !/^\s*(`{3,}|~{3,})/.test(lines[i]) && entries.length))) {
        const match = lines[i].match(item);
        if (match) entries.push({ text: [match[3]], depth: Math.min(3, Math.floor(match[1].length / 2)) }); else entries[entries.length - 1].text.push(lines[i].trim());
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={blocks.length}>{entries.map((entry, n) => {
        const task = entry.text[0].match(/^\[([ xX])\]\s+(.*)$/);
        return <li key={n} className={task ? 'md-task' : undefined} style={entry.depth ? { marginLeft: entry.depth * 18 } : undefined}>{task ? <><span className={`md-check ${task[1] === ' ' ? '' : 'is-done'}`} aria-hidden>{task[1] === ' ' ? '' : '✓'}</span>{withBreaks([task[2], ...entry.text.slice(1)])}</> : withBreaks(entry.text)}</li>;
      })}</List>);
      continue;
    }
    // The first line always belongs to the paragraph, so the loop always advances.
    const paragraph: string[] = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !/^\s*(`{3,}|~{3,}|#{1,6}\s|>|\|)/.test(lines[i]) && !item.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={blocks.length}>{withBreaks(paragraph)}</p>);
  }
  return <div className={`markdown ${className}`}>{blocks}</div>;
}
