import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// O dev server faz proxy de /api e /ws para o Studio Server.
// - local:   http://localhost:7900
// - Docker:  STUDIO_SERVER_URL=http://studioserver:7900 (definido pelo compose na fase `infra`)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.STUDIO_SERVER_URL || process.env.STUDIO_SERVER_URL || 'http://localhost:7900';
  const port = Number(env.STUDIO_UI_PORT || process.env.STUDIO_UI_PORT || 5173);

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target, ws: true, changeOrigin: true },
      },
      // volumes Docker em macOS/Windows nao propagam inotify
      watch: process.env.STUDIO_WATCH_POLLING === 'true' ? { usePolling: true } : undefined,
    },
    build: { chunkSizeWarningLimit: 6000 },
  };
});
