import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { refusal } from './src/request-policy.ts';

const root = fileURLToPath(new URL('.', import.meta.url)), src = join(root, 'src');
process.env.PR_GUIDE_DATA_DIR ??= join(root, '.data');

function localServer(): Plugin {
  return {
    name: 'local-server',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const header = (name: string) => { const value = request.headers[name]; return typeof value === 'string' ? value : undefined; };
        const reason = refusal({ host: header('host'), origin: header('origin'), fetchSite: header('sec-fetch-site'), port: request.socket.localPort ?? 0 });
        if (!reason) return next();
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: reason }));
      });
      // Vite closes itself on SIGTERM, but not on Ctrl-C or a terminal hangup.
      const stop = () => void Promise.all([globalThis.ryvuRuntime?.close(), server.close()]).finally(() => process.exit());
      process.once('SIGINT', stop); process.once('SIGHUP', stop);
    },
    async hotUpdate({ file, modules }) {
      if (this.environment.name === 'ssr' && modules.length && dirname(file) === src && !file.endsWith('.functions.ts')) await globalThis.ryvuRuntime?.close();
    },
    closeServer: () => globalThis.ryvuRuntime?.close()
  };
}

export default defineConfig({
  plugins: [tanstackStart({ spa: { enabled: true }, importProtection: { behavior: 'error', client: { specifiers: [/^node:/] } } }), react(), tailwindcss(), localServer()],
  resolve: { alias: { '@': join(src, 'web') } },
  optimizeDeps: { include: ['react-markdown', 'remark-gfm', 'remark-frontmatter', 'rehype-slug', 'mermaid'] },
  build: { chunkSizeWarningLimit: 1800 },
  server: { host: '127.0.0.1', port: Number(process.env.WEB_PORT ?? 5173), strictPort: true }
});
