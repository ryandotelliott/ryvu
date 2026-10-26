import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight, GitPullRequest, Plus, Search, Settings as SettingsIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarRail, SidebarSeparator, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { homeLink, settingsLink } from './links';
import { Kbd, Tip } from './ui';
import type { Settings } from '../types';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const commandKey = isMac ? '⌘' : 'Ctrl ';

type NavigationProps = { active?: 'home' | 'settings'; settings: Settings | null; repoCounts: Record<string, number> | null; selectedRepo?: string; onSearch: () => void };

// Hides the sidebar from inside it. Once hidden, a page's top bar shows `ShowSidebar` in its place.
function HideSidebar() {
  return <Tip content="Hide sidebar" hotkey={`${commandKey}B`} side="bottom"><SidebarTrigger aria-label="Hide sidebar" className="ml-1 shrink-0" /></Tip>;
}
export function ShowSidebar() {
  const { isMobile, open, openMobile } = useSidebar();
  if (isMobile ? openMobile : open) return null;
  return <Tip content="Show sidebar" hotkey={`${commandKey}B`} side="bottom"><SidebarTrigger aria-label="Show sidebar" /></Tip>;
}

export function AppSidebar({ active, settings, repoCounts, selectedRepo, onSearch, children, footer }: NavigationProps & { children?: ReactNode; footer?: ReactNode }) {
  const total = repoCounts ? Object.values(repoCounts).reduce((sum, count) => sum + count, 0) : null;
  const { setOpenMobile } = useSidebar(), closeMobile = () => setOpenMobile(false);
  return <Sidebar aria-label={children ? 'Review sidebar' : 'Main'}>
    <SidebarHeader>
      <div className="flex items-center">
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton variant="outline" onClick={onSearch}><Search /><span className="min-w-0 flex-1 truncate">Find a pull request</span><Kbd>{commandKey}K</Kbd></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
        <HideSidebar />
      </div>
    </SidebarHeader>
    <SidebarContent className={children ? 'overflow-hidden' : undefined}>
      <div className={children ? 'max-h-[45svh] shrink-0 overflow-y-auto overscroll-contain' : undefined}>
        <SidebarGroup aria-label="Navigation"><SidebarGroupContent><SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link {...homeLink()} />} onClick={closeMobile} isActive={active === 'home' && !selectedRepo}><GitPullRequest /><span>Pull requests</span></SidebarMenuButton>
            {total !== null ? <SidebarMenuBadge>{total}</SidebarMenuBadge> : !settings && <SidebarMenuBadge><Skeleton className="h-3 w-5" /></SidebarMenuBadge>}
          </SidebarMenuItem>
        </SidebarMenu></SidebarGroupContent></SidebarGroup>
        <Collapsible defaultOpen><SidebarGroup>
          <SidebarGroupLabel render={<CollapsibleTrigger />} className="[&[data-panel-open]>svg]:rotate-90"><span>Repositories</span><ChevronRight className="ml-auto transition-transform" /></SidebarGroupLabel>
          <CollapsibleContent><SidebarGroupContent><SidebarMenu>
            {settings ? settings.repos.map(repo => <SidebarMenuItem key={repo}>
              <Tip content={repo} delay="long" side="right"><SidebarMenuButton render={<Link {...homeLink({ repo })} />} onClick={closeMobile} isActive={selectedRepo === repo}>
                <span>{repo}</span>
              </SidebarMenuButton></Tip>
              {repoCounts?.[repo] !== undefined && <SidebarMenuBadge>{repoCounts[repo]}</SidebarMenuBadge>}
            </SidebarMenuItem>) : <SidebarMenuItem><SidebarMenuSkeleton /></SidebarMenuItem>}
            <SidebarMenuItem><SidebarMenuButton render={<Link {...settingsLink} />} onClick={closeMobile} className="text-muted-foreground hover:bg-transparent hover:text-foreground active:bg-transparent active:text-foreground focus-visible:text-foreground"><Plus /><span>Add repository</span></SidebarMenuButton></SidebarMenuItem>
          </SidebarMenu></SidebarGroupContent></CollapsibleContent>
        </SidebarGroup></Collapsible>
      </div>
      {children && <><SidebarSeparator />{children}</>}
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu><SidebarMenuItem className="flex min-w-0 items-center gap-1">
        <Tip content="Settings" side="right"><SidebarMenuButton render={<Link {...settingsLink} />} onClick={closeMobile} isActive={active === 'settings'} aria-label="Settings" className="size-8 justify-center p-0"><SettingsIcon /></SidebarMenuButton></Tip>
        {footer}
      </SidebarMenuItem></SidebarMenu>
    </SidebarFooter>
    <Tip content="Drag to resize; double-click to reset" side="right"><SidebarRail /></Tip>
  </Sidebar>;
}

export function AppShell({ children, ...navigation }: NavigationProps & { children: ReactNode }) {
  return <>
    <AppSidebar {...navigation} />
    <SidebarInset className="min-w-0">
      <header className="flex h-12 shrink-0 items-center border-b px-3"><ShowSidebar /></header>
      {children}
    </SidebarInset>
  </>;
}
