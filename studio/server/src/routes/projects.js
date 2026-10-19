'use strict';

/**
 * Projetos: lista aberta, criar, abrir, importar, clonar, arquivar, recentes e templates.
 * `GET /api/projects` continua devolvendo `{ projects }`.
 * Arquivos e arvore ficam em routes/files.js (`/tree`, `/file`).
 */

const { asyncHandler } = require('../util/asyncHandler');
const { projectApi } = require('../projects/service');

module.exports = (app, deps) => {
  const api = projectApi(deps);

  app.get('/api/projects', (req, res) => {
    res.json({ projects: deps.registry.list().map((ctx) => ctx.toJSON()) });
  });

  app.get('/api/recentes', (req, res) => {
    res.json(api.recentes());
  });

  app.delete(
    '/api/recentes',
    asyncHandler(async (req, res) => {
      res.json(api.forgetRecente((req.body && (req.body.rootPath || req.body.path)) || req.query.path));
    }),
  );

  app.get('/api/templates', (req, res) => {
    res.json(api.templates());
  });

  app.get('/api/templates/:id', (req, res) => {
    res.json(api.template(req.params.id, req.query.source));
  });

  app.get(
    '/api/ports',
    asyncHandler(async (req, res) => {
      res.json(await api.ports());
    }),
  );

  app.get('/api/workspace/projects', (req, res) => {
    res.json(api.workspace());
  });

  app.post('/api/projects/open', (req, res) => {
    res.json(api.open(req.body || {}));
  });

  app.post('/api/projects/import-preview', (req, res) => {
    res.json(api.previewImport(req.body || {}));
  });

  app.post('/api/projects/import', (req, res) => {
    res.json(api.importProject(req.body || {}));
  });

  app.post(
    '/api/projects',
    asyncHandler(async (req, res) => {
      res.status(201).json(await api.create(req.body || {}));
    }),
  );

  app.post('/api/projects/archive', (req, res) => {
    const body = req.body || {};
    res.json(api.archiveByPath(body.path || body.rootPath));
  });

  app.post('/api/projects/unarchive', (req, res) => {
    res.json(api.unarchive(req.body || {}));
  });

  app.post('/api/projects/:id/close', (req, res) => {
    res.json(api.close(req.params.id));
  });

  app.post(
    '/api/projects/:id/clone',
    asyncHandler(async (req, res) => {
      res.status(201).json(await api.clone(req.params.id, req.body || {}));
    }),
  );

  app.post('/api/projects/:id/archive', (req, res) => {
    res.json(api.archive(req.params.id));
  });

  app.post('/api/projects/:id/save-template', (req, res) => {
    res.status(201).json(api.saveTemplate(req.params.id, req.body || {}));
  });

  app.post('/api/projects/:id/studio-blocks', (req, res) => {
    res.json(api.ensureBlocks(req.params.id));
  });

  app.get('/api/projects/:id', (req, res) => {
    res.json(deps.registry.require(req.params.id).toJSON());
  });
};
