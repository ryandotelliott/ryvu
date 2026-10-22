import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const api = `http://127.0.0.1:${process.env.PORT ?? 4317}`;
export default defineConfig({
  root: 'src/web', logLevel: 'warn',
  plugins: [react(), tailwindcss(), {
    // Page routes are handled in the browser; without this, /settings would resolve to the settings.tsx module.
    name: 'page-routes',
    configureServer: server => { server.middlewares.use((request, _response, next) => {
      if (request.headers.accept?.includes('text/html') && request.url && !request.url.startsWith('/api/') && !/\.[A-Za-z0-9]+(\?|$)/.test(request.url)) request.url = '/index.html';
      next();
    }); }
  }],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)) } },
  build: { outDir: '../../dist/public', emptyOutDir: true, chunkSizeWarningLimit: 1800 },
  // Dev only: forward /api to the local server. It accepts only its own origin, so same-origin
  // requests from the dev page are rewritten to it; anything else is passed through and rejected.
  server: {
    host: '127.0.0.1', strictPort: true,
    proxy: { '^/api/': { target: api, changeOrigin: true, configure: proxy => proxy.on('proxyReq', (request, incoming) => {
      if (incoming.headers.origin === `http://${incoming.headers.host}`) request.setHeader('origin', api);
    }) } }
  }
});
