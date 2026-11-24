import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** In development, serve /api/* from the same code Vercel runs in production. */
function devApi(): Plugin {
  type Loader = () => Promise<{ route: (r: Request) => Promise<Response> }>;
  const handler = (load: Loader) => async (req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) return next();
    try {
      const { route } = await load();
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
      const response = await route(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  };
  return {
    name: 'ffim-dev-api',
    configureServer(server) {
      server.middlewares.use(handler(() => server.ssrLoadModule('/server/http.ts') as never));
    },
    configurePreviewServer(server) {
      // `npm run preview` (the production build) also gets the API, loaded through tsx
      server.middlewares.use(handler(async () => (await import('tsx/esm/api')).tsImport('./server/http.ts', import.meta.url) as never));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Server-side settings from .env (database, AI keys) for the local dev server
  for (const [k, v] of Object.entries(env)) if (!k.startsWith('VITE_') && v && !(k in process.env)) process.env[k] = v;

  return {
    plugins: [
      react(),
      devApi(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'logo.png'],
        manifest: {
          id: '/',
          name: 'FFIM Gather',
          short_name: 'Gather',
          description: 'Map your neighbourhood, track visits and care for members.',
          theme_color: '#12603a',
          background_color: '#eef3ec',
          display: 'standalone',
          display_override: ['standalone', 'minimal-ui'],
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          lang: 'en',
          categories: ['productivity', 'lifestyle'],
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    server: { host: true },
    build: { chunkSizeWarningLimit: 1200 },
    worker: { format: 'es' },
  };
});
