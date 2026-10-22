import type { ReactNode } from 'react';
import { GitPullRequest, Plus, Search, Settings as SettingsIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { homeHref } from './routes';
import { Kbd, RepoSwatch, Tip, repoColor } from './ui';
import type { Settings } from '../types';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const commandKey = isMac ? '⌘' : 'Ctrl ';

export function AppShell({ active, settings, repoCounts, selectedRepo, onSearch, children }: { active: 'home' | 'settings'; settings: Settings | null; repoCounts: Record<string, number> | null; selectedRepo?: string; onSearch: () => void; children: ReactNode }) {
  const total = repoCounts ? Object.values(repoCounts).reduce((sum, count) => sum + count, 0) : null;
  return <div className="app-shell">
    <aside className="app-sidebar" aria-label="Main">
      <div className="brand">PR Guide</div>
      <Button variant="outline" className="w-full justify-start font-normal text-muted-foreground" onClick={onSearch}><Search /><span className="flex-1 text-left">Find a pull request</span><Kbd>{commandKey}K</Kbd></Button>
      <nav className="sidebar-nav">
        <a href="/" className={active === 'home' && !selectedRepo ? 'is-active' : ''} aria-current={active === 'home' && !selectedRepo ? 'page' : undefined}><GitPullRequest size={14} /><span>Pull requests</span>{total !== null && <span className="nav-count">{total}</span>}</a>
        <a href="/settings" className={active === 'settings' ? 'is-active' : ''} aria-current={active === 'settings' ? 'page' : undefined}><SettingsIcon size={14} /><span>Settings</span></a>
      </nav>
      <div className="sidebar-repos">
        <span className="sidebar-label">Repositories</span>
        {settings?.repos.map(repo => <Tip key={repo} content={repo} delay="long" side="right"><a href={homeHref({ repo })} className={selectedRepo === repo ? 'is-active' : ''}>
          <RepoSwatch color={repoColor(settings.repos, repo)} /><span className="repo-name">{repo}</span>{repoCounts?.[repo] !== undefined && <span className="nav-count">{repoCounts[repo]}</span>}
        </a></Tip>)}
        <a href="/settings" className="add-repo-link"><Plus size={12} /><span>Add repository</span></a>
      </div>
    </aside>
    <div className="mobile-header">
      <a href="/" className="brand">PR Guide</a>
      <div className="mobile-header-actions">
        <Button variant="ghost" size="icon" aria-label="Find a pull request" onClick={onSearch}><Search size={17} /></Button>
        <a href="/settings" className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label="Settings"><SettingsIcon size={17} /></a>
      </div>
    </div>
    <main className="app-main">{children}</main>
  </div>;
}
