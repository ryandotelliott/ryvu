import type { ComponentProps, ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
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
        <div className="topbar-actions">{actions}</div>
      </header>
      {children}
    </SidebarInset>
  </>;
}
