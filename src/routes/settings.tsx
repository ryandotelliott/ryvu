import { useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useApplication } from '../web/application-context';
import { SettingsPage } from '../web/settings';
import { AppShell } from '../web/shell';

export const Route = createFileRoute('/settings')({ component: Settings });

function Settings() {
  const app = useApplication();
  useEffect(() => { document.title = 'Settings · PR Guide'; }, []);
  return <AppShell active="settings" settings={app.settings} repoCounts={app.repoCounts} onSearch={app.openPalette}>
    <SettingsPage settings={app.settings} onSettings={app.setSettings} />
  </AppShell>;
}
