import { createFileRoute, Navigate } from '@tanstack/react-router';
import { PullPage } from '../web/app';
import { pullTarget } from '../web/links';

export const Route = createFileRoute('/pr/$owner/$repo/$number/{-$view}')({
  validateSearch: (search: Record<string, unknown>): { analyze?: 1 } => String(search.analyze) === '1' ? { analyze: 1 } : {},
  component: Pull
});

function Pull() {
  const target = pullTarget(Route.useParams(), Route.useSearch().analyze === 1);
  return target ? <PullPage target={target} /> : <Navigate to="/" replace />;
}
