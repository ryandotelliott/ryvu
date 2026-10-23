import { createContext, useContext } from 'react';
import type { ApplicationState } from './app';

// app.tsx exports only components so Fast Refresh updates it in place, and this context object outlives those updates.
export const AppContext = createContext<ApplicationState | null>(null);
export function useApplication() {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApplication is only available inside <Application>.');
  return app;
}
