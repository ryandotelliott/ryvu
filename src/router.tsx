import { createRouter, parseSearchWith, stringifySearchWith } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Each PR view keeps its own scroll position; a range of stacked PRs (?through=) is a page of its own, and so is each file on Files.
    getScrollRestorationKey: location => {
      if (!location.pathname.startsWith('/pr/')) return location.state.__TSR_key ?? location.href;
      const search = location.search as Record<string, unknown>, kept = ['through', 'branch', 'path'].filter(name => name in search).map(name => `${name}=${search[name]}`);
      return `${location.pathname}${kept.length ? `?${kept.join('&')}` : ''}`;
    },
    // Search values stay plain strings, so URLs keep their URLSearchParams form, such as ?tab=review and ?analyze=1.
    parseSearch: parseSearchWith(value => value),
    stringifySearch: stringifySearchWith(String)
  });
}
