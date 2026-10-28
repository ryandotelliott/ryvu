import { type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Screenshot } from './screenshot';

// Compact inline formatting for headings, summaries and file labels.
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
const CodeBlock: NonNullable<Components['pre']> = ({ node, children }) => {
  const code = node?.children[0];
  if (code?.type !== 'element' || code.tagName !== 'code') return <pre>{children}</pre>;
  const classes = code.properties.className;
  if (!Array.isArray(classes) || !classes.includes('language-diff')) return <pre>{children}</pre>;
  const text = code.children.flatMap(child => child.type === 'text' ? [child.value] : []).join('');
  return <pre><code>{text.split('\n').map((line, index, lines) => <span key={index} className={line.startsWith('+') ? 'md-add' : line.startsWith('-') ? 'md-del' : undefined}>{line}{index < lines.length - 1 ? '\n' : ''}</span>)}</code></pre>;
};
const components: Components = {
  a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>,
  img: ({ src, alt, width, height }) => <Screenshot src={src} alt={alt} width={width} height={height} />,
  h1: ({ children }) => <p className="md-heading md-h1">{children}</p>,
  h2: ({ children }) => <p className="md-heading md-h2">{children}</p>,
  h3: ({ children }) => <p className="md-heading md-h3">{children}</p>,
  h4: ({ children }) => <p className="md-heading md-h4">{children}</p>,
  h5: ({ children }) => <p className="md-heading md-h4">{children}</p>,
  h6: ({ children }) => <p className="md-heading md-h4">{children}</p>,
  table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
  pre: CodeBlock
};

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`markdown ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw, rehypeSanitize]}
    urlTransform={(url, key) => key === 'src' && !/^https:\/\//i.test(url) ? undefined : safeUrl(url) ?? undefined} components={components}>{text}</ReactMarkdown></div>;
}
