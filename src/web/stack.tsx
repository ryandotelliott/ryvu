import { Link } from '@tanstack/react-router';
import { Menu } from '@base-ui/react/menu';
import { CornerDownRight, Layers } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { pullLink, type PullViewName } from './links';
import { PullIcon, Tip } from './ui';
import type { PullStack, StackedPull } from '../types';

const checkLabels = { success: 'Checks passed', failure: 'Checks failing', pending: 'Checks running' } as const;

// The top bar's title for a stacked PR. It opens the stack, top first, so you can step to the PRs above and below this one.
export function StackMenu({ repo, number, title, stack, view }: { repo: string; number: number; title: string; stack: PullStack; view: PullViewName }) {
  const position = stack.pulls.length - stack.pulls.findIndex(pull => pull.number === number);
  return <DropdownMenu>
    <Tip content={`${repo} #${number}: ${title}`} delay="long" side="bottom">
      <DropdownMenuTrigger className="topbar-title stack-trigger" aria-label={`#${number} ${title}, ${position} of ${stack.pulls.length} in a stack`}>
        <Layers size={14} className="stack-icon" aria-hidden /><span className="topbar-number">#{number}</span><span>{title}</span>
      </DropdownMenuTrigger>
    </Tip>
    <DropdownMenuContent sideOffset={6} className="stack-menu">
      <DropdownMenuGroup>
        <DropdownMenuLabel className="stack-label">{stack.pulls.length} stacked</DropdownMenuLabel>
        {stack.pulls.map(pull => <StackRow key={pull.number} pull={pull} current={pull.number === number} repo={repo} view={view} />)}
      </DropdownMenuGroup>
      {stack.base && <div className="stack-base"><CornerDownRight size={14} aria-hidden /><code>{stack.base}</code></div>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function StackRow({ pull, current, repo, view }: { pull: StackedPull; current: boolean; repo: string; view: PullViewName }) {
  return <Menu.LinkItem closeOnClick label={`#${pull.number} ${pull.title}`} className="stack-row" aria-current={current ? 'page' : undefined} render={<Link {...pullLink(repo, pull.number, view)} />}>
    <span className="stack-status">
      <PullIcon draft={pull.draft} state={pull.state} size={15} />
      {pull.checks && <span className={`stack-checks ${pull.checks}`} role="img" aria-label={checkLabels[pull.checks]} />}
    </span>
    <span className="topbar-number">#{pull.number}</span>
    <span className="stack-title">{pull.title}</span>
    <span className="stack-diff"><span className="added">+{pull.additions.toLocaleString()}</span><span className="removed">−{pull.deletions.toLocaleString()}</span></span>
  </Menu.LinkItem>;
}
