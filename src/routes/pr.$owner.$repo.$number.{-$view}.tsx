import { createFileRoute, Navigate } from '@tanstack/react-router';
import { PullPage } from '../web/app';
import { pullLink, pullTarget } from '../web/links';

export const Route = createFileRoute('/pr/$owner/$repo/$number/{-$view}')({
  // `through` names a second PR of the same stack; the page then shows every PR between the two as one diff.
  validateSearch: (search: Record<string, unknown>): { analyze?: 1; through?: number } => ({
    ...(String(search.analyze) === '1' ? { analyze: 1 as const } : {}),
    ...(/^[1-9][0-9]{0,9}$/.test(String(search.through)) ? { through: Number(search.through) } : {})
  }),
  component: Pull
});

function Pull() {
  const target = pullTarget(Route.useParams(), Route.useSearch());
  if (!target) return <Navigate to="/" replace />;
  // A range has no guide, so its Guide link leads to the combined diff.
  if (target.through && target.view === 'guide') return <Navigate {...pullLink(target.repo, target.number, 'diff', { through: target.through })} replace />;
  return <PullPage target={target} />;
}
