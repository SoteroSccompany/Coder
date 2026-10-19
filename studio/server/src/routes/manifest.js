'use strict';

/**
 * Editor do manifesto e do env-example.txt.
 * O .env real continua no ignore e nao e lido aqui.
 */

const { asyncHandler } = require('../util/asyncHandler');
const { projectApi } = require('../projects/service');

module.exports = (app, deps) => {
  const api = projectApi(deps);

  app.get('/api/projects/:id/manifest', (req, res) => {
    res.json(api.getManifest(req.params.id));
  });

  app.put('/api/projects/:id/manifest', (req, res) => {
    res.json(api.updateManifest(req.params.id, req.body || {}));
  });

  app.get(
    '/api/projects/:id/env-example',
    asyncHandler(async (req, res) => {
      res.json(await api.getEnvExample(req.params.id));
    }),
  );

  app.put(
    '/api/projects/:id/env-example',
    asyncHandler(async (req, res) => {
      res.json(await api.putEnvExample(req.params.id, req.body || {}));
    }),
  );
};
