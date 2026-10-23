import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { GitPullRequest, Plus, Search, Settings as SettingsIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { homeLink, settingsLink } from './links';
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
        <Link {...homeLink()} className={active === 'home' && !selectedRepo ? 'is-active' : ''} aria-current={active === 'home' && !selectedRepo ? 'page' : undefined}><GitPullRequest size={14} /><span>Pull requests</span>{total !== null && <span className="nav-count">{total}</span>}</Link>
        <Link {...settingsLink} className={active === 'settings' ? 'is-active' : ''} aria-current={active === 'settings' ? 'page' : undefined}><SettingsIcon size={14} /><span>Settings</span></Link>
      </nav>
      <div className="sidebar-repos">
        <span className="sidebar-label">Repositories</span>
        {settings?.repos.map(repo => <Tip key={repo} content={repo} delay="long" side="right"><Link {...homeLink({ repo })} className={selectedRepo === repo ? 'is-active' : ''}>
          <RepoSwatch color={repoColor(settings.repos, repo)} /><span className="repo-name">{repo}</span>{repoCounts?.[repo] !== undefined && <span className="nav-count">{repoCounts[repo]}</span>}
        </Link></Tip>)}
        <Link {...settingsLink} className="add-repo-link"><Plus size={12} /><span>Add repository</span></Link>
      </div>
    </aside>
    <div className="mobile-header">
      <Link {...homeLink()} className="brand">PR Guide</Link>
      <div className="mobile-header-actions">
        <Button variant="ghost" size="icon" aria-label="Find a pull request" onClick={onSearch}><Search size={17} /></Button>
        <Link {...settingsLink} className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label="Settings"><SettingsIcon size={17} /></Link>
      </div>
    </div>
    <main className="app-main">{children}</main>
  </div>;
}
