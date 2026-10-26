import type { ComponentProps, ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { SidebarInset, useSidebar } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { pullLink, pullViews, type PullViewName } from './links';
import { AppSidebar, ShowSidebar } from './shell';
import { StackMenu } from './stack';
import { Tip } from './ui';
import type { PullStack } from '../types';

export function ReviewLayout({ navigation, repo, number, title, stack, view, sidebar, sidebarFooter, actions, analyzing = false, loading = false, children }: {
  navigation: ComponentProps<typeof AppSidebar>;
  repo: string;
  number: number;
  title?: string;
  stack?: PullStack | null;
  view: PullViewName;
  sidebar: ReactNode;
  sidebarFooter?: ReactNode;
  actions: ReactNode;
  analyzing?: boolean;
  loading?: boolean;
  children: ReactNode;
}) {
  const { isMobile, open, openMobile } = useSidebar();
  const sidebarVisible = isMobile ? openMobile : open;
  const caption = <span className="topbar-title"><span className="topbar-number">#{number}</span>{title ? <span>{title}</span> : <Skeleton className="h-3.5 w-48 self-center" />}</span>;
  return <>
    <AppSidebar {...navigation} footer={sidebarFooter}>{sidebar}</AppSidebar>
    <SidebarInset className={`pr-page view-${view} min-w-0`} data-sidebar-open={sidebarVisible && !isMobile} aria-busy={loading || undefined} aria-label={loading ? 'Loading the pull request' : undefined}>
      <header className="pr-topbar">
        <ShowSidebar />
        {title && stack ? <StackMenu repo={repo} number={number} title={title} stack={stack} view={view} />
          : title ? <Tip content={`${repo} #${number}: ${title}`} delay="long" side="bottom">{caption}</Tip> : caption}
        <nav className="view-tabs" aria-label="View">{pullViews.map(([name, label], i) => <Tip key={name} content={label} hotkey={String(i + 1)} delay="long" side="bottom"><Link {...pullLink(repo, number, name)} className={view === name ? 'is-active' : ''} aria-current={view === name ? 'page' : undefined}>{label}{name === 'guide' && analyzing && <LoaderCircle size={12} className="spinner" />}</Link></Tip>)}</nav>
        <div className="topbar-actions">
          <Tip content="Open on GitHub" side="bottom"><a className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'text-muted-foreground' })} href={`https://github.com/${repo}/pull/${number}`} target="_blank" rel="noopener noreferrer" aria-label="Open pull request on GitHub">
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" /></svg>
          </a></Tip>
          {actions}
        </div>
      </header>
      {children}
    </SidebarInset>
  </>;
}
