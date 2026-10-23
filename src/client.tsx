import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { StartClient } from '@tanstack/react-start/client';

if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));
startTransition(() => { hydrateRoot(document, <StartClient />); });
