import type { ComponentProps } from 'react';
import { ChevronDown, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarGroup, SidebarGroupAction, SidebarGroupLabel } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import type { KnownPull } from './browser-state';
import type { PullTarget } from './links';
import { ReviewLayout } from './review-layout';
import { Avatar } from './ui';

function TextLines({ widths }: { widths: string[] }) {
  return <div aria-hidden="true">{widths.map((width, index) => <div key={index} className="flex h-[1lh] items-center"><Skeleton className={`h-[0.65em] ${width}`} /></div>)}</div>;
}

function FileSkeleton() {
  return <article className="diff-card expanded" aria-hidden="true">
    <div className="file-heading">
      <div className="file-toggle"><ChevronRight size={13} className="chevron" /><Skeleton className="h-3 w-32 max-w-full" /></div>
      <div className="file-count"><Skeleton className="h-3 w-6" /><Skeleton className="h-3 w-6" /></div>
      <div className="file-reviewed"><Skeleton className="size-3.5" />Reviewed</div>
    </div>
    <div className="diff-card-body">
      <Skeleton className="h-[max(216px,calc(100svh-var(--sticky-top)-56px))] w-full rounded-none" />
    </div>
  </article>;
}

export function PullSkeleton({ target, pull, navigation }: { target: PullTarget; pull?: KnownPull; navigation: ComponentProps<typeof ReviewLayout>['navigation'] }) {
  const hasGuide = pull?.guide !== null;
  const heading = <header className="pr-heading">
    {pull?.title ? <h1>{pull.title}</h1> : <Skeleton className="pr-heading-skeleton w-2/3" />}
    <div className="review-meta">
      {pull?.state && pull.state !== 'open' ? <span className={`state-chip ${pull.state}`}>{pull.state === 'merged' ? 'Merged' : 'Closed'}</span> : pull?.isDraft ? <span className="state-chip draft">Draft</span> : null}
      {pull?.author ? <><Avatar login={pull.author} size={18} /><span className="author">{pull.author}</span></> : <><Skeleton className="size-[18px] rounded-full" /><Skeleton className="h-3 w-20" /></>}
      <span className="meta-separator">·</span><span className="meta-repo">{target.repo} #{target.number}</span>
      {pull?.branch && <><span className="meta-separator">·</span><span className="branches"><Skeleton className="h-[18.5px] w-9" />←<code>{pull.branch}</code></span></>}
    </div>
  </header>;
  const files = <SidebarGroup className="file-tree min-h-0 flex-1" aria-label="Files" aria-busy="true">
    <SidebarGroupLabel>Files <Skeleton className="ml-2 h-3 w-5" /></SidebarGroupLabel>
    <SidebarGroupAction className="right-10" aria-label="Search files" disabled><Search /></SidebarGroupAction>
    <SidebarGroupAction aria-label="File list display" disabled><SlidersHorizontal /></SidebarGroupAction>
    <div className="overflow-hidden" aria-hidden="true">{['w-28', 'w-36', 'w-24', 'w-32', 'w-40', 'w-28', 'w-36', 'w-24'].map((width, index) => <div key={index} className="list-file"><Skeleton className="size-3.5" /><Skeleton className={`h-3 max-w-full ${width}`} /></div>)}</div>
  </SidebarGroup>;
  return <ReviewLayout navigation={navigation} repo={target.repo} number={target.number} through={target.through} title={pull?.title} stack={pull?.stack} view={target.view} sidebar={files} loading
    actions={!target.through && <Button size="sm" disabled>Review<ChevronDown size={12} /></Button>}
  >
    {target.view === 'overview' ? <div className="overview-layout">
      <div className="overview-main">
        {heading}
        <details className="description" open><summary>Description<ChevronDown size={12} className="chevron" /></summary><div className="description-text"><TextLines widths={['w-full', 'w-full', 'w-11/12', 'w-2/3']} /></div></details>
      </div>
      <aside className="overview-side" aria-label="Details">{['Status', 'Reviewers', 'Checks', 'Branch'].map(label => <section key={label}><h4>{label}</h4><div className="side-row"><Skeleton className="size-4" /><Skeleton className="h-3 w-28" /></div></section>)}<Skeleton className="h-3 w-36" /></aside>
    </div>
      : target.view === 'guide' ? <div className="guide-page">
        <div className="guide-head">
          {heading}
          {hasGuide && <><div className="review-summary"><TextLines widths={['w-full', 'w-3/4']} /></div><div className="guide-meta"><Skeleton className="h-3 w-40" /><Skeleton className="h-6 w-24" /></div></>}
        </div>
        {hasGuide ? <section className="chapter-section">
          <div className="explanation"><Skeleton className="h-6 w-3/4" /><div className="chapter-progress"><Skeleton className="h-3 w-12" /><Skeleton className="h-6 w-24" /></div><div className="chapter-copy"><TextLines widths={['w-full', 'w-full', 'w-4/5']} /></div></div>
          <div className="diff-panel"><FileSkeleton /></div>
        </section> : <div className="analyze-empty"><Skeleton className="h-[27px] w-60 max-w-full" /><div className="w-full text-[13.5px] leading-[1.6]"><TextLines widths={['w-full', 'w-full', 'w-full', 'w-full', 'w-4/5']} /></div><Skeleton className="h-8 w-20" /></div>}
      </div>
        : <div className="diff-page">
          <div className="diff-toolbar"><div className="toolbar-stat"><Skeleton className="h-3 w-10" /><Skeleton className="h-3 w-10" /></div><Skeleton className="h-3 w-24" /><div className="toolbar-actions"><Skeleton className="h-3 w-20" /><Button variant="ghost" size="icon-sm" aria-label="Display settings" disabled><SlidersHorizontal /></Button></div></div>
          <div className="diff-body"><div className="diff-panel"><FileSkeleton /></div></div>
        </div>}
  </ReviewLayout>;
}
