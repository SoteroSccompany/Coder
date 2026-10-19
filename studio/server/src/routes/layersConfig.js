'use strict';

/**
 * Mover/renomear camada.
 * dryRun devolve o diff e nao grava. confirm: true aplica (com rollback se falhar).
 */

const { projectApi } = require('../projects/service');

module.exports = (app, deps) => {
  const api = projectApi(deps);

  app.post('/api/projects/:id/layers/rename', (req, res) => {
    res.json(api.renameLayer(req.params.id, req.body || {}));
  });
};
