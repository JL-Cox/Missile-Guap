import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

/**
 * Whether this page has been loaded inside someone else's frame.
 *
 * A <meta> CSP cannot say `frame-ancestors`, and GitHub Pages will not send the
 * header, so another site could show Steady in an invisible frame and trick
 * taps onto it. Rendering nothing at all in a frame takes that away. Reading
 * `window.top` across origins is allowed for exactly this comparison; if a
 * browser throws anyway, assume the worst.
 */
function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

if (!isFramed()) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // The service worker only ever caches this app's own files so it keeps working
  // with no signal. It has no fetch path to any other origin.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const base = import.meta.env.BASE_URL;
      navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
        // Offline support is a bonus; the app works fine without it.
      });
    });
  }
}
