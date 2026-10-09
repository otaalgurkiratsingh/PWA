/** Theme preference. Light is the default; "system" follows the phone. Applied before paint by /theme-init.js. */
export type Theme = 'system' | 'light' | 'dark';
const KEY = 'rozana.theme';

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'dark' || t === 'system' ? t : 'light';
  } catch {
    return 'light';
  }
}

export function resolvedTheme(t: Theme = readTheme()): 'light' | 'dark' {
  if (t === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return t;
}

export function applyTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // preference is a convenience only
  }
  document.documentElement.setAttribute('data-theme', resolvedTheme(t));
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', resolvedTheme(t) === 'dark' ? '#101216' : '#f7f8fa');
  window.dispatchEvent(new Event('rozana-theme'));
}

/** Keep "System" in sync when the phone switches modes. */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};
  const on = () => readTheme() === 'system' && applyTheme('system');
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}
