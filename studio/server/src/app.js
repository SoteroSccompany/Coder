'use strict';

/**
 * Monta a aplicacao (Express + servicos) SEM abrir porta — assim os testes (supertest) a reutilizam.
 * O boot real (porta, projetos iniciais, shutdown) fica em `src/index.js`.
 */

const http = require('http');
const crypto = require('crypto');
const express = require('express');

const pkg = require('../package.json');
const { createProjectRegistry } = require('./context/projectContext');
const { createFileService } = require('./services/fileService');
const { createWsHub } = require('./services/wsHub');
const { createWatcherService } = require('./services/watcherService');
const ast = require('./services/astService');
const { loadRoutes } = require('./routes');
const { HttpError } = require('./util/httpError');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Le o token do pedido: `Authorization: Bearer x`, `x-studio-token` ou `?token=`. */
function tokenFrom(req, url) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.headers['x-studio-token']) return String(req.headers['x-studio-token']);
  const q = url ? url.searchParams.get('token') : req.query && req.query.token;
  return q || '';
}

function createApp(overrides = {}) {
  const config = {
    version: pkg.version,
    token: process.env.STUDIO_TOKEN || '',
    watch: true,
    ...overrides,
  };

  const registry = overrides.registry || createProjectRegistry();
  const files = createFileService();
  const hub = createWsHub({
    authenticate: config.token ? (req, url) => safeEqual(tokenFrom(req, url), config.token) : null,
  });
  const watcher = createWatcherService({ registry, hub, files, options: overrides.watcherOptions });

  /** `ext` e o saco livre para fases futuras pendurarem servicos proprios. */
  const deps = { config, registry, files, watcher, hub, ast, ext: {} };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  // Autenticacao opcional por token (tudo em /api, exceto /api/health).
  app.use('/api', (req, res, next) => {
    if (!config.token || req.path === '/health') return next();
    if (safeEqual(tokenFrom(req), config.token)) return next();
    return next(new HttpError(401, 'UNAUTHORIZED', 'Token ausente ou invalido'));
  });

  const loadedRoutes = loadRoutes(app, deps);

  app.use('/api', (req, res, next) => next(new HttpError(404, 'NOT_FOUND', `Rota nao encontrada: ${req.method} ${req.path}`)));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON invalido', code: 'BAD_JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Corpo muito grande', code: 'PAYLOAD_TOO_LARGE' });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...err.details });
    }
    console.error('[studio] erro nao tratado:', err);
    return res.status(500).json({ error: 'Erro interno', code: 'INTERNAL' });
  });

  const server = http.createServer(app);
  hub.attach(server);
  if (config.watch) watcher.start();

  async function close() {
    await watcher.stop();
    hub.close();
    await new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));
  }

  return { app, server, deps, loadedRoutes, close };
}

module.exports = { createApp };
