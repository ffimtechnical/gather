import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { listenForInstall } from './install';

registerSW({ immediate: true });
listenForInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/** Fade the launch screen once the first screen is drawn (kept up at least briefly so it doesn't flash). */
const splash = document.getElementById('splash');
if (splash) {
  const wait = Math.max(0, 900 - performance.now());
  setTimeout(() => {
    requestAnimationFrame(() => {
      splash.classList.add('gone');
      setTimeout(() => splash.remove(), 600);
    });
  }, wait);
}
