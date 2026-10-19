'use strict';

/**
 * Boot do Studio Server.
 *
 * Variaveis de ambiente:
 *   STUDIO_SERVER_PORT   porta HTTP/WS (padrao 7900)
 *   STUDIO_HOST          interface de escuta (padrao 0.0.0.0 — necessario dentro do container)
 *   STUDIO_TOKEN         token opcional; quando definido, /api/* (menos /api/health) e /ws o exigem
 *   STUDIO_PROJECTS      caminhos de projetos a abrir no boot, separados por virgula
 *                        (padrao em dev local: ../../api, se existir)
 *   STUDIO_WATCH_POLLING true para usar polling no watcher (volumes Docker em macOS/Windows)
 *
 * SEGURANCA: o Studio le/escreve arquivos e (em fases futuras) controla Docker. Escutar em 0.0.0.0 e
 * necessario so DENTRO do container; ao publicar a porta no host, restrinja a rede local
 * (ex.: "127.0.0.1:7900:7900" no compose), defina STUDIO_TOKEN e NUNCA exponha em producao/internet.
 */

const fs = require('fs');
const path = require('path');
const { createApp } = require('./app');

const PORT = Number(process.env.STUDIO_SERVER_PORT || 7900);
const HOST = process.env.STUDIO_HOST || '0.0.0.0';

function initialProjects() {
  if (process.env.STUDIO_PROJECTS) {
    return process.env.STUDIO_PROJECTS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const devApi = path.resolve(__dirname, '../../../api');
  return fs.existsSync(devApi) ? [devApi] : [];
}

async function main() {
  const studio = createApp();

  for (const p of initialProjects()) {
    try {
      const ctx = studio.deps.registry.open(p);
      console.log(`[studio] projeto aberto: ${ctx.id} -> ${ctx.rootPath}`);
    } catch (err) {
      console.warn(`[studio] nao foi possivel abrir ${p}: ${err.message}`);
    }
  }

  studio.server.listen(PORT, HOST, () => {
    console.log(`[studio] server em http://${HOST}:${PORT} (rotas: ${studio.loadedRoutes.join(', ')})`);
    if (!process.env.STUDIO_TOKEN) {
      console.warn('[studio] AVISO: STUDIO_TOKEN nao definido — mantenha o servico restrito a rede local.');
    }
  });

  const shutdown = async () => {
    await studio.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
