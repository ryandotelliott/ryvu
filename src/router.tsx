import { createRouter, parseSearchWith, stringifySearchWith } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Search values stay plain strings, so URLs keep their URLSearchParams form, such as ?tab=review and ?analyze=1.
    parseSearch: parseSearchWith(value => value),
    stringifySearch: stringifySearchWith(String)
  });
}
