import { createFileRoute, Navigate } from '@tanstack/react-router';
import { homeSearch } from '../web/links';

// A matched route hydrates the prebuilt SPA shell before redirecting.
export const Route = createFileRoute('/$')({ component: Elsewhere });

function Elsewhere() {
  return <Navigate to="/" search={homeSearch(Route.useSearch())} replace />;
}
