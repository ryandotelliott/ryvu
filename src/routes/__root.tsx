import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Application } from '../web/app';
import style from '../web/style.css?url';

const icon = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%236767d0%22/%3E%3Cpath d=%22M9 10.5h5.5a2.5 2.5 0 0 1 2.5 2.5v9a2 2 0 0 0-2-2H9zM23 10.5h-5.5A2.5 2.5 0 0 0 15 13v9a2 2 0 0 1 2-2h6z%22 fill=%22none%22 stroke=%22white%22 stroke-width=%221.8%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E';

export const Route = createRootRoute({
  head: () => ({ meta: [{ title: 'PR Guide' }], links: [{ rel: 'icon', href: icon }, { rel: 'stylesheet', href: style }] }),
  shellComponent: Document,
  component: () => <TooltipProvider><Application><Outlet /></Application></TooltipProvider>
});

// The theme colors are written here because head() keeps only one meta tag per name.
function Document({ children }: { children: ReactNode }) {
  return <html lang="en">
    <head>
      <meta charSet="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light dark" />
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" /><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />
      <HeadContent />
    </head>
    <body>{children}<Scripts /></body>
  </html>;
}
