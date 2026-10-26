import { createRouter, parseSearchWith, stringifySearchWith } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Each PR view keeps its own scroll position; a range of stacked PRs (?through=) is a page of its own.
    getScrollRestorationKey: location => location.pathname.startsWith('/pr/') ? `${location.pathname}${'through' in location.search ? `?through=${location.search.through}` : ''}` : location.state.__TSR_key ?? location.href,
    // Search values stay plain strings, so URLs keep their URLSearchParams form, such as ?tab=review and ?analyze=1.
    parseSearch: parseSearchWith(value => value),
    stringifySearch: stringifySearchWith(String)
  });
}
