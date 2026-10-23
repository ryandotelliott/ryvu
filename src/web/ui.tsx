import { Component, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { Avatar as AvatarRoot, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Switch as SwitchRoot } from '@/components/ui/switch';
import { Kbd } from '@/components/ui/kbd';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { JobView } from '../types';

export const repoColors = ['#6767d0', '#d08a3e', '#3f9a78', '#c06aae', '#4f8fc0', '#b8615a', '#8a7a5c', '#4f9aa8'];
export function repoColor(repos: string[], repo: string) {
  const index = repos.findIndex(name => name.toLowerCase() === repo.toLowerCase());
  return index === -1 ? '#ababb4' : repoColors[index % repoColors.length];
}
export function RepoSwatch({ color, size = 8 }: { color: string; size?: number }) { return <span className="repo-swatch" style={{ background: color, width: size, height: size }} aria-hidden />; }

const avatarColors = ['#5b7fd6', '#c06aae', '#d08a3e', '#3f9a78', '#8a7a5c', '#7d8ca3', '#b8615a', '#4f9aa8'];
export function Avatar({ login, size = 20 }: { login: string; size?: number }) {
  const hash = [...login].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  return <Tip content={login} delay="long"><AvatarRoot className="avatar" aria-hidden style={{ width: size, height: size }}>
    <AvatarFallback className="font-semibold text-white" style={{ fontSize: Math.round(size * 0.4), background: avatarColors[hash % avatarColors.length] }}>{login.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()}</AvatarFallback>
  </AvatarRoot></Tip>;
}

export function PullIcon({ draft, state = 'open', size = 15 }: { draft?: boolean; state?: 'open' | 'closed' | 'merged'; size?: number }) {
  const tone = state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : draft ? 'draft' : 'open';
  return <svg className={`pull-icon ${tone}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-label={tone === 'open' ? 'Open' : tone[0].toUpperCase() + tone.slice(1)}>
    <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
    {state === 'merged' ? <><circle cx="6" cy="18" r="3" /><path d="M6 9v6" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /></>
      : draft ? <><path d="M18 6V5" /><path d="M18 11v-1" /><path d="M6 9v12" /></>
      : state === 'closed' ? <><path d="M6 9v12" /><path d="m21 3-6 6" /><path d="m21 9-6-6" /></>
      : <><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M6 9v12" /></>}
  </svg>;
}

export { Kbd };

// For a popover's `initialFocus`: keyboard opens move focus inside as usual; mouse and touch opens leave it on the trigger, so nothing inside lights up.
export const focusOnKeyboardOpen = (openType: string) => openType === 'keyboard';

// Hover delays: `long` for labels on things you read (truncated names), `short` for icon buttons, `instant` for dense controls you scan.
const tipDelays = { long: 700, short: 300, instant: 0 } as const;
export type TipDelay = keyof typeof tipDelays;
// A tooltip around one element; the child must accept a ref and props (shadcn buttons and plain elements do).
export function Tip({ content, hotkey, delay = 'short', side = 'top', children }: { content: ReactNode; hotkey?: string; delay?: TipDelay; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement }) {
  return <Tooltip>
    <TooltipTrigger delay={tipDelays[delay]} render={children} />
    <TooltipContent side={side}>{content}{hotkey && <Kbd>{hotkey}</Kbd>}</TooltipContent>
  </Tooltip>;
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'sm' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (value: T) => void; label: string; size?: 'sm' | 'md' }) {
  // A single-choice toggle group; selecting the current option again keeps it selected.
  return <ToggleGroup aria-label={label} size={size === 'sm' ? 'sm' : 'default'} spacing={0} className="gap-0.5 rounded-lg bg-muted p-0.5" value={[value]} onValueChange={next => { if (next[0]) onChange(next[0] as T); }}>
    {options.map(option => <ToggleGroupItem key={option.value} value={option.value} className="rounded-md! px-2.5 text-muted-foreground hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm">{option.label}</ToggleGroupItem>)}
  </ToggleGroup>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <SwitchRoot checked={checked} onCheckedChange={value => onChange(value)} aria-label={label} />;
}

export function StatusBox({ job, error, canCancel, onCancel, action }: { job: JobView | null; error: string; canCancel: boolean; onCancel: () => void; action?: ReactNode }) {
  const busy = !error && (job?.state === 'loading' || job?.state === 'generating');
  const [started] = useState(() => Date.now()), [now, setNow] = useState(started);
  useEffect(() => { if (!busy) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [busy]);
  const seconds = Math.floor((now - started) / 1000), elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <div role={error ? 'alert' : 'status'} className={`statusbox ${error ? 'error' : ''}`}>
    {busy ? <LoaderCircle size={16} className="spinner" /> : error ? <CircleAlert size={16} /> : null}
    <div className="statusbox-text"><p>{error || job?.message}</p>{busy && <small>{job?.state === 'generating' ? 'Arranging sections and checking every reference against the diff. This can take a few minutes.' : 'Loading the PR through your existing GitHub sign-in.'}</small>}</div>
    {busy && <span className="elapsed" aria-label={`Elapsed ${elapsed}`}>{elapsed}</span>}
    {busy && <Button variant="outline" size="sm" disabled={!canCancel} onClick={onCancel}>Cancel</Button>}
    {action}
  </div>;
}

export function Highlighted({ runs }: { runs: { text: string; hit: boolean }[] }) {
  return <>{runs.map((run, i) => run.hit ? <mark key={i}>{run.text}</mark> : <span key={i}>{run.text}</span>)}</>;
}

// A vertical drag handle that resizes the element before it. Arrow keys step by 16px; double-click resets.
export function ResizeHandle({ value, min, max, onChange, onReset, label, className = '' }: { value: number; min: number; max: number; onChange: (value: number) => void; onReset?: () => void; label: string; className?: string }) {
  const clamp = (next: number) => Math.round(Math.min(max, Math.max(min, next)));
  return <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0} className={`resize-handle ${className}`}
    onDoubleClick={onReset}
    onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onChange(clamp(value + (event.key === 'ArrowRight' ? 16 : -16))); } }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget, startX = event.clientX, startValue = value;
      handle.setPointerCapture(event.pointerId); document.body.classList.add('is-resizing');
      const move = (moved: PointerEvent) => onChange(clamp(startValue + moved.clientX - startX));
      const end = () => { handle.removeEventListener('pointermove', move); document.body.classList.remove('is-resizing'); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end, { once: true }); handle.addEventListener('pointercancel', end, { once: true });
    }} />;
}

// Settings rows that read like menu items (label left, check right) but are ordinary form controls,
// so Tab reaches them. Built on Base UI's headless checkbox and radio because shadcn's draw a box or circle.
export function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return <CheckboxPrimitive.Root checked={checked} onCheckedChange={value => onChange(Boolean(value))} className="option-row">
    {children}<CheckboxPrimitive.Indicator className="option-check"><Check size={15} /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}
export function RadioRows<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: { value: T; label: ReactNode }[] }) {
  return <RadioGroupPrimitive aria-label={label} value={value} onValueChange={next => onChange(next as T)} className="option-group">
    {options.map(option => <Radio.Root key={option.value} value={option.value} className="option-row">{option.label}<Radio.Indicator className="option-check"><Check size={15} /></Radio.Indicator></Radio.Root>)}
  </RadioGroupPrimitive>;
}
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
