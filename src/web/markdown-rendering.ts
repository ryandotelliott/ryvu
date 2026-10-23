import { getSharedHighlighter } from '@pierre/diffs';

const themes = { light: 'pierre-light', dark: 'pierre-dark' };

export async function highlightMarkdownCode(code: string, language: string): Promise<string> {
  const highlighter = await getSharedHighlighter({ themes: Object.values(themes), langs: [language] });
  return highlighter.codeToHtml(code, { lang: language, themes, defaultColor: false });
}

// Mermaid's configuration is global, so initialization and rendering must share the same queue.
let diagramQueue: Promise<void> = Promise.resolve();
export function renderMarkdownDiagram(code: string, id: string, dark: boolean): Promise<string> {
  const rendering = diagramQueue.then(async () => {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', htmlLabels: false, suppressErrorRendering: true,
      theme: dark ? 'dark' : 'neutral', fontFamily: getComputedStyle(document.documentElement).fontFamily, logLevel: 'fatal',
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels']
    });
    return (await mermaid.render(id, code)).svg;
  });
  diagramQueue = rendering.then(() => {}, () => {});
  return rendering;
}
