import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeSlug from 'rehype-slug';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readFile } from '../pull.functions';
import { DiffSourceContext, fileAnchor } from './pull-page';
import { highlightMarkdownCode, renderMarkdownDiagram } from './markdown-rendering';
import type { ChangedFile } from '../types';

type Loaded<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; message: string };
const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
function subscribeTheme(onChange: () => void) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function MermaidBlock({ code }: { code: string }) {
  const dark = useSyncExternalStore(subscribeTheme, () => window.matchMedia('(prefers-color-scheme: dark)').matches, () => false);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, ''), generation = useRef(0);
  const [result, setResult] = useState<Loaded<string>>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    setResult({ status: 'loading' });
    void renderMarkdownDiagram(code, `mermaid-${id}-${++generation.current}`, dark).then(
      value => { if (active) setResult({ status: 'ready', value }); },
      error => { if (active) setResult({ status: 'error', message: message(error) }); }
    );
    return () => { active = false; };
  }, [code, id, dark]);
  if (result.status === 'loading') return <div className="markdown-preview-status" role="status"><LoaderCircle size={14} className="spinner" />Rendering diagram…</div>;
  if (result.status === 'error') return <div className="mermaid-error"><p role="alert">This Mermaid diagram could not be rendered. {result.message}</p><pre><code>{code}</code></pre></div>;
  return <figure className="mermaid-diagram" aria-label="Mermaid diagram" dangerouslySetInnerHTML={{ __html: result.value }} />;
}
function HighlightedCode({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setHtml(null);
    void highlightMarkdownCode(code, language).then(value => { if (active) setHtml(value); }, () => {});
    return () => { active = false; };
  }, [code, language]);
  return html ? <div className="highlighted-code" dangerouslySetInnerHTML={{ __html: html }} /> : <pre><code>{code}</code></pre>;
}
const CodeBlock: NonNullable<Components['pre']> = ({ node, children }) => {
  const code = node?.children[0];
  if (code?.type !== 'element' || code.tagName !== 'code') return <pre>{children}</pre>;
  const text = code.children.flatMap(child => child.type === 'text' ? [child.value] : []).join('').replace(/\n$/, '');
  const classes = code.properties.className;
  const language = Array.isArray(classes) ? classes.find(value => typeof value === 'string' && value.startsWith('language-'))?.toString().slice(9).toLowerCase() : undefined;
  return language === 'mermaid' ? <MermaidBlock code={text} /> : <HighlightedCode code={text} language={language || 'text'} />;
};

export default function MarkdownPreview({ file }: { file: ChangedFile }) {
  const source = useContext(DiffSourceContext), [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Loaded<string>>({ status: 'loading' });
  const sha = file.status === 'removed' ? source?.base : source?.head;
  const path = file.status === 'removed' ? file.previousPath ?? file.path : file.path;
  useEffect(() => {
    let active = true;
    setResult({ status: 'loading' });
    if (!source || !sha) { setResult({ status: 'error', message: 'The file’s commit is unavailable.' }); return; }
    void readFile({ data: { repo: source.repo, sha, path } }).then(
      value => { if (active) setResult({ status: 'ready', value }); },
      error => { if (active) setResult({ status: 'error', message: message(error) }); }
    );
    return () => { active = false; };
  }, [source, sha, path, attempt]);
  if (result.status === 'loading') return <div className="markdown-preview-status" role="status"><LoaderCircle size={14} className="spinner" />Loading preview…</div>;
  if (result.status === 'error') return <div className="markdown-preview-status" role="alert"><span>Could not load this Markdown file. {result.message}</span><Button variant="outline" size="xs" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>;
  const prefix = `${fileAnchor(file.path)}-`, base = `https://github.com/${source?.repo}/blob/${sha}/`, fileUrl = base + path.split('/').map(encodeURIComponent).join('/');
  return <div className="markdown markdown-file-preview">
    {file.status === 'removed' && <p className="markdown-preview-note">Deleted file · showing the base version</p>}
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]} rehypePlugins={[[rehypeSlug, { prefix }]]} skipHtml
      urlTransform={url => {
        const safe = defaultUrlTransform(url);
        if (!safe) return undefined;
        if (safe.startsWith('#')) return `#${prefix}${safe.slice(1)}`;
        try { return new URL(safe.startsWith('/') && !safe.startsWith('//') ? safe.slice(1) : safe, safe.startsWith('/') ? base : fileUrl).href; }
        catch { return undefined; }
      }}
      components={{
        pre: CodeBlock,
        a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{children}</a>,
        img: ({ src, alt }) => <a href={src} target="_blank" rel="noreferrer">{alt || 'View image'}</a>,
        table: ({ children }) => <div className="md-table"><table>{children}</table></div>
      }}>
      {result.value}
    </ReactMarkdown>
  </div>;
}
