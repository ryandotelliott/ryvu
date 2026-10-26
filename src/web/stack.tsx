import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Menu } from '@base-ui/react/menu';
import { CornerDownRight, Layers } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { pullLink, type PullViewName } from './links';
import { rangeLabel } from './pull-page';
import { PullIcon, Tip } from './ui';
import type { PullStack, StackedPull } from '../types';

const checkLabels = { success: 'Checks passed', failure: 'Checks failing', pending: 'Checks running' } as const;
type Span = 'top' | 'middle' | 'bottom';

// The top bar's title for a stacked PR, or for a range of PRs in one stack. It opens the stack, top first, so you can step to
// the PRs above and below. The PR you're on is one end of a range: clicking another PR's dot marks the other end, and
// shift-clicking a PR opens the range straight away.
export function StackMenu({ repo, number, through, title, stack, view }: { repo: string; number: number; through: number | null; title: string; stack: PullStack; view: PullViewName }) {
  const navigate = useNavigate(), [end, setEnd] = useState(through);
  const at = (value: number | null) => stack.pulls.findIndex(pull => pull.number === value);
  const between = (other: number | null) => { const from = at(number), to = at(other); return from < 0 || to < 0 || from === to ? [] : stack.pulls.slice(Math.min(from, to), Math.max(from, to) + 1); };
  const current = between(through), picked = between(end);
  const rangeTo = (other: number) => pullLink(repo, number, 'diff', { through: other });
  const span = (pull: StackedPull): Span | null => !picked.includes(pull) ? null : pull === picked[0] ? 'top' : pull === picked[picked.length - 1] ? 'bottom' : 'middle';
  const position = stack.pulls.length - at(number);
  return <DropdownMenu onOpenChange={open => { if (open) setEnd(through); }}>
    <Tip content={current.length ? `${repo} ${rangeLabel(current)}: ${current.length} stacked pull requests` : `${repo} #${number}: ${title}`} delay="long" side="bottom">
      <DropdownMenuTrigger className="topbar-title stack-trigger" aria-label={current.length ? `${rangeLabel(current)}, ${current.length} of ${stack.pulls.length} stacked pull requests` : `#${number} ${title}, ${position} of ${stack.pulls.length} in a stack`}>
        <Layers size={14} className="stack-icon" aria-hidden />{current.length ? <span>{rangeLabel(current)}</span> : <><span className="topbar-number">#{number}</span><span>{title}</span></>}
      </DropdownMenuTrigger>
    </Tip>
    <DropdownMenuContent sideOffset={6} className="stack-menu">
      <DropdownMenuGroup>
        <DropdownMenuLabel className="stack-label"><span>{stack.pulls.length} stacked</span><span>Click a dot to review with #{number}</span></DropdownMenuLabel>
        {stack.pulls.map((pull, index) => <StackRow key={pull.number} pull={pull} repo={repo} view={view} anchor={pull.number === number} current={!through && pull.number === number} span={span(pull)}
          last={index === stack.pulls.length - 1 && !stack.base} onPick={() => setEnd(previous => previous === pull.number ? null : pull.number)} onRange={() => void navigate(rangeTo(pull.number))} />)}
      </DropdownMenuGroup>
      {stack.base && <div className="stack-base"><CornerDownRight size={14} aria-hidden /><code>{stack.base}</code></div>}
      {end !== null && picked.length > 0 && <div className="stack-footer">
        <span className="stack-sum"><b>{rangeLabel(picked)}</b>{picked.length} pull requests
          <span className="stack-diff"><span className="added">+{picked.reduce((sum, pull) => sum + pull.additions, 0).toLocaleString()}</span><span className="removed">−{picked.reduce((sum, pull) => sum + pull.deletions, 0).toLocaleString()}</span></span>
        </span>
        <Menu.LinkItem closeOnClick label="Review together" className={buttonVariants({ size: 'sm' })} render={<Link {...rangeTo(end)} />}>Review together</Menu.LinkItem>
      </div>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

// A stack row with its dot on the rail. The rail draws the picked range; `last` ends it at this row when no base follows.
function StackRow({ pull, repo, view, anchor, current, span, last, onPick, onRange }: { pull: StackedPull; repo: string; view: PullViewName; anchor: boolean; current: boolean; span: Span | null; last: boolean; onPick: () => void; onRange: () => void }) {
  return <div className={`stack-line ${span ? `in-range range-${span}` : ''} ${last ? 'is-last' : ''}`}>
    {anchor ? <span className="stack-dot is-anchor" aria-hidden />
      : <button type="button" tabIndex={-1} className={`stack-dot ${span ? 'is-picked' : ''}`} aria-label={`Review #${pull.number} together with this pull request`} aria-pressed={span === 'top' || span === 'bottom'} onClick={onPick} />}
    <Menu.LinkItem closeOnClick label={`#${pull.number} ${pull.title}`} className="stack-row" aria-current={current ? 'page' : undefined} render={<Link {...pullLink(repo, pull.number, view)} />}
      onClick={event => { if (event.shiftKey && !anchor) { event.preventDefault(); onRange(); } }}>
      <span className="stack-status">
        <PullIcon draft={pull.draft} state={pull.state} size={15} />
        {pull.checks && <span className={`stack-checks ${pull.checks}`} role="img" aria-label={checkLabels[pull.checks]} />}
      </span>
      <span className="topbar-number">#{pull.number}</span>
      <span className={`stack-title ${anchor ? 'is-anchor' : ''}`}>{pull.title}</span>
      <span className="stack-diff"><span className="added">+{pull.additions.toLocaleString()}</span><span className="removed">−{pull.deletions.toLocaleString()}</span></span>
    </Menu.LinkItem>
  </div>;
}
