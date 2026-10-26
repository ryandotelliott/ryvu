import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { pullLink } from './links';
import { Markdown } from './markdown';
import { rangeLabel } from './pull-page';
import { Avatar, PullIcon } from './ui';
import type { RangePull } from '../types';

// The Overview of a range: each PR's description, bottom first, in the order its changes build on each other.
export function RangeOverview({ repo, pulls }: { repo: string; pulls: RangePull[] }) {
  const base = pulls[pulls.length - 1].baseRef;
  const sum = (key: 'additions' | 'deletions') => pulls.reduce((total, pull) => total + pull[key], 0).toLocaleString();
  return <div className="overview-layout range-overview">
    <div className="overview-main">
      <header className="pr-heading">
        <h1>{pulls.length} stacked pull requests</h1>
        <div className="review-meta">
          <span className="meta-repo">{repo} {rangeLabel(pulls)}</span>
          {base && <><span className="meta-separator">·</span><span className="branches"><code>{base}</code>←<code>{pulls[0].headRef}</code></span></>}
          <span className="meta-separator">·</span><span className="added">+{sum('additions')}</span><span className="removed">−{sum('deletions')}</span>
        </div>
      </header>
      {[...pulls].reverse().map(pull => <section key={pull.number} className="range-pull">
        <h2><PullIcon draft={pull.draft} state={pull.state} size={16} /><Link {...pullLink(repo, pull.number)}><span className="topbar-number">#{pull.number}</span>{pull.title}</Link></h2>
        <div className="review-meta">
          <Avatar login={pull.author} size={18} /><span className="author">{pull.author}</span>
          {pull.baseRef && pull.headRef && <><span className="meta-separator">·</span><span className="branches"><code>{pull.baseRef}</code>←<code>{pull.headRef}</code></span></>}
          <span className="meta-separator">·</span><span className="added">+{pull.additions.toLocaleString()}</span><span className="removed">−{pull.deletions.toLocaleString()}</span>
        </div>
        <details className="description" open>
          <summary>Description<ChevronDown size={12} className="chevron" /></summary>
          {pull.body.trim() ? <Markdown className="description-text" text={pull.body} /> : <p className="description-text is-empty">No description provided.</p>}
        </details>
      </section>)}
    </div>
  </div>;
}
