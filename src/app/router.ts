import { useEffect, useState } from 'react';

export const TABS = ['today', 'food', 'workout', 'progress'] as const;
export type Tab = (typeof TABS)[number];
export type RouteName = Tab | 'settings' | 'coach' | 'chat' | 'draft' | 'plan' | 'meal' | 'photos' | 'answers';
export interface Route {
  name: RouteName;
  param: string | null;
}

const NAMES: readonly RouteName[] = [...TABS, 'settings', 'coach', 'chat', 'draft', 'plan', 'meal', 'photos', 'answers'];

export function parseRoute(hash: string = location.hash): Route {
  const [name, param] = hash.replace(/^#\/?/, '').split('/');
  return NAMES.includes(name as RouteName) ? { name: name as RouteName, param: param ? decodeURIComponent(param) : null } : { name: 'today', param: null };
}

export function navigate(name: RouteName, param?: string) {
  const next = `#/${name}${param ? `/${encodeURIComponent(param)}` : ''}`;
  if (location.hash !== next) location.hash = next;
}

/** Change the address without a navigation (keeps the current screen and its state). */
export function replaceRoute(name: RouteName, param?: string) {
  history.replaceState(history.state, '', `#/${name}${param ? `/${encodeURIComponent(param)}` : ''}`);
}

export function goBack(fallback: RouteName) {
  if (history.length > 1) history.back();
  else navigate(fallback);
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parseRoute());
  useEffect(() => {
    const on = () => setR(parseRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
