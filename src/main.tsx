import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/core/design/tokens.css';
import '@/core/design/app.css';
import { App } from '@/app/App';
import { registerServiceWorker } from '@/app/serviceWorker';
import { applyTheme, readTheme } from '@/core/design/theme';

applyTheme(readTheme());
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
