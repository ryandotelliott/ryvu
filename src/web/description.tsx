import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from './markdown';
import { scrollPageBy } from './pull-page';

// A PR description cut to about 12 lines, fading out under a floating Expand button. Pass `expanded` to control it,
// such as to open it when find lands on a match inside.
export function Description({ body, expanded: controlled, onExpandedChange }: { body: string; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void }) {
  const [own, setOwn] = useState(false), expanded = controlled ?? own, setExpanded = onExpandedChange ?? setOwn;
  const root = useRef<HTMLDivElement>(null), [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const element = root.current, content = element?.querySelector('.description-text');
    if (!element || !content) return;
    // Long means at least two lines past the cut, so a description is never folded to hide one line. Diagrams and images
    // change the height after they load, so this measures again whenever the content resizes.
    const measure = () => setLong(content.scrollHeight > parseFloat(getComputedStyle(element).getPropertyValue('--description-clamp')) * 7 / 6);
    const observer = new ResizeObserver(measure);
    observer.observe(content); measure();
    return () => observer.disconnect();
  }, [body]);
  // Collapsing from the end of a long description keeps the button where it was instead of leaving you far down the page.
  function collapse(event: MouseEvent<HTMLButtonElement>) {
    const before = event.currentTarget.getBoundingClientRect().top;
    setExpanded(false);
    requestAnimationFrame(() => { const after = root.current?.querySelector('.description-fade button')?.getBoundingClientRect().top; if (after !== undefined) scrollPageBy(after - before); });
  }
  if (!body.trim()) return <p className="description-text is-empty">No description provided.</p>;
  const clamped = long && !expanded;
  return <div ref={root} className={`description ${clamped ? 'is-clamped' : ''}`} data-description>
    <div className="description-clip"><Markdown className="description-text" text={body} /></div>
    {clamped && <div className="description-fade"><Button variant="outline" size="sm" className="rounded-full bg-background shadow-sm" aria-label="Expand description" onClick={() => setExpanded(true)}>Expand<ChevronDown /></Button></div>}
    {long && expanded && <Button variant="ghost" size="xs" className="mt-2 text-muted-foreground" aria-label="Collapse description" onClick={collapse}><ChevronUp />Collapse</Button>}
  </div>;
}
