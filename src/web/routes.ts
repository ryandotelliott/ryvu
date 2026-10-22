import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home'; params: URLSearchParams }
  | { name: 'settings' }
  | { name: 'pr'; owner: string; repo: string; number: number; view: PullViewName; analyze: boolean };
export type PullViewName = 'overview' | 'guide' | 'diff';

export function parseRoute(path: string, query: string): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'pr' && (parts.length === 4 || (parts.length === 5 && ['guide', 'diff', 'changes'].includes(parts[4]))) && /^[1-9][0-9]{0,9}$/.test(parts[3])) return { name: 'pr', owner: parts[1], repo: parts[2], number: Number(parts[3]), view: parts[4] === 'guide' ? 'guide' : parts[4] === 'diff' || parts[4] === 'changes' ? 'diff' : 'overview', analyze: new URLSearchParams(query).get('analyze') === '1' };
  return { name: 'home', params: new URLSearchParams(query) };
}
export function prHref(repo: string, number: number, view: PullViewName = 'overview', analyze = false) { return `/pr/${repo}/${number}${view === 'overview' ? '' : `/${view}`}${analyze ? '?analyze=1' : ''}`; }
export function homeHref(params?: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) if (value !== undefined && value !== '' && !(key === 'page' && value === 1)) query.set(key, String(value));
  const text = query.toString();
  return `/${text ? `?${text}` : ''}`;
}
export function navigate(href: string, replace = false) {
  if (replace) history.replaceState(null, '', href); else history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
// Plain clicks on links within the app change the route without reloading the page.
function onLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a') : null;
  if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download') || link.getAttribute('href')?.startsWith('#')) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin) return;
  event.preventDefault(); navigate(url.pathname + url.search);
}
const current = () => parseRoute(location.pathname, location.search);
export function useRoute(): Route {
  const [route, setRoute] = useState(() => {
    // Links from before path-based routing used #/… URLs.
    if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));
    return current();
  });
  useEffect(() => {
    const update = () => setRoute(current());
    window.addEventListener('popstate', update); document.addEventListener('click', onLinkClick);
    return () => { window.removeEventListener('popstate', update); document.removeEventListener('click', onLinkClick); };
  }, []);
  return route;
}
