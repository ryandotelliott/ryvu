import { useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useApplication } from '../web/application-context';
import { Home } from '../web/home';
import { homeSearch } from '../web/links';
import { AppShell } from '../web/shell';

export const Route = createFileRoute('/')({ validateSearch: homeSearch, component: HomePage });

function HomePage() {
  const filters = Route.useSearch(), app = useApplication();
  useEffect(() => { document.title = 'Pull requests · PR Guide'; }, []);
  return <AppShell active="home" settings={app.settings} repoCounts={app.repoCounts} selectedRepo={filters.repo} onSearch={app.openPalette}>
    <Home filters={filters} settings={app.settings} onSettings={app.setSettings} onPage={app.onPage} />
  </AppShell>;
}
