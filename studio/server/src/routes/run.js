'use strict';

/**
 * Voo da armadura: liga o node do projeto, aciona, traça e testa.
 *
 *   POST /api/projects/:id/run/ligar
 *   POST /api/projects/:id/run/desligar
 *   POST /api/projects/:id/run/acionar    { method, path, body }
 *   POST /api/projects/:id/run/voo        { path, method, className, input }
 *   POST /api/projects/:id/run/testar     { path? }
 */

const { asyncHandler } = require('../util/asyncHandler');
const { createProcesso } = require('../run/processo');

module.exports = (app, deps) => {
  const processo = createProcesso(deps);
  deps.ext.processo = processo;

  app.post(
    '/api/projects/:id/run/ligar',
    asyncHandler(async (req, res) => {
      const ctx = deps.registry.require(req.params.id);
      res.json(await processo.ligar(ctx));
    }),
  );

  app.post(
    '/api/projects/:id/run/desligar',
    asyncHandler(async (req, res) => {
      const ctx = deps.registry.require(req.params.id);
      res.json(await processo.desligar(ctx));
    }),
  );

  app.post(
    '/api/projects/:id/run/acionar',
    asyncHandler(async (req, res) => {
      const ctx = deps.registry.require(req.params.id);
      res.json(await processo.acionar(ctx, req.body || {}));
    }),
  );

  app.post(
    '/api/projects/:id/run/voo',
    asyncHandler(async (req, res) => {
      const ctx = deps.registry.require(req.params.id);
      res.json(await processo.voo(ctx, req.body || {}));
    }),
  );

  app.post(
    '/api/projects/:id/run/testar',
    asyncHandler(async (req, res) => {
      const ctx = deps.registry.require(req.params.id);
      res.json(await processo.testar(ctx, req.body || {}));
    }),
  );
};
