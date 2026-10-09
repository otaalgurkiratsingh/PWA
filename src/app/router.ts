import { useEffect, useState } from 'react';

export const ROUTES = ['today', 'meals', 'train', 'progress', 'settings'] as const;
export type Route = (typeof ROUTES)[number];

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(h) ? (h as Route) : 'today';
}

export function navigate(r: Route) {
  if (parse() !== r) location.hash = `#/${r}`;
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
