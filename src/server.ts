import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { withinLimit } from './request-policy';

export { serve } from './serve';

export default createServerEntry({
  async fetch(request) {
    const checked = await withinLimit(request);
    return checked instanceof Response ? checked : handler.fetch(checked);
  }
});
