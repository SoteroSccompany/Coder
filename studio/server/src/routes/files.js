'use strict';

const { asyncHandler } = require('../util/asyncHandler');

/**
 * Arquivos de um projeto.
 *   GET /api/projects/:id/tree            -> arvore agrupada por layer ({ layers, other })
 *   GET /api/projects/:id/file?path=      -> { path, content, hash, mtimeMs, size, layer }
 *   PUT /api/projects/:id/file?path=      -> body { content, baseHash }  (baseHash null = arquivo novo)
 *                                            200 { path, hash, mtimeMs, size, created } | 409 CONFLICT
 */
module.exports = (app, deps) => {
  const { registry, files } = deps;

  app.get(
    '/api/projects/:id/tree',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      res.json(await files.treeByLayer(ctx));
    }),
  );

  app.get(
    '/api/projects/:id/file',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      res.json(await files.readFile(ctx, req.query.path));
    }),
  );

  app.put(
    '/api/projects/:id/file',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      const body = req.body || {};
      res.json(await files.writeFile(ctx, req.query.path, body.content, body.baseHash));
    }),
  );
};
