'use strict';

/** GET /api/health — usado por healthcheck do compose e pela UI (nao exige token). */
module.exports = (app, deps) => {
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'coder-studio-server',
      version: deps.config.version,
      uptimeSec: Math.round(process.uptime()),
      projects: deps.registry.list().length,
      authRequired: !!deps.config.token,
    });
  });
};
