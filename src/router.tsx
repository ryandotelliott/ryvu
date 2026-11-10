import { createRouter, parseSearchWith, stringifySearchWith } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Each PR view, stack range, commit and file keeps its own scroll position.
    getScrollRestorationKey: location => {
      if (!location.pathname.startsWith('/pr/')) return location.state.__TSR_key ?? location.href;
      const search = location.search as Record<string, unknown>, kept = ['through', 'commit', 'branch', 'path'].filter(name => name in search).map(name => `${name}=${search[name]}`);
      return `${location.pathname}${kept.length ? `?${kept.join('&')}` : ''}`;
    },
    // Search values stay plain strings, so URLs keep their URLSearchParams form, such as ?tab=review and ?analyze=1.
    parseSearch: parseSearchWith(value => value),
    stringifySearch: stringifySearchWith(String)
  });
}
