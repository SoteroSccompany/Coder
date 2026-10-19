'use strict';

/**
 * Blocos: biblioteca, fluxo (decompor / gerar) e criacao a partir de um trecho.
 *
 *   GET  /api/blocks                              biblioteca global
 *   GET  /api/projects/:id/blocks                 biblioteca efetiva (global + projeto)
 *   GET  /api/projects/:id/blocks/flow?path=&method=
 *   PUT  /api/projects/:id/blocks/flow?path=      body { method, className?, blocks, baseHash }
 *   POST /api/projects/:id/blocks                 cria .block.json (scope project | global)
 */

const { asyncHandler } = require('../util/asyncHandler');
const { HttpError } = require('../util/httpError');
const { createBlockService } = require('../blocks/service');

module.exports = (app, deps) => {
  const service = createBlockService(deps);
  deps.ext.blocks = service;
  const { registry, files, hub } = deps;

  app.get(
    '/api/blocks',
    asyncHandler(async (_req, res) => {
      res.json({ blocks: service.libraryFor(null).map(service.toPublic) });
    }),
  );

  app.get(
    '/api/projects/:id/blocks',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      res.json({ blocks: service.libraryFor(ctx).map(service.toPublic) });
    }),
  );

  app.get(
    '/api/projects/:id/blocks/flow',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      const file = await files.readFile(ctx, req.query.path);
      let flow;
      try {
        flow = service.decompose(file.content, ctx);
      } catch (err) {
        if (err instanceof SyntaxError) {
          throw HttpError.badRequest('SYNTAX', `Arquivo JS invalido: ${err.message}`);
        }
        throw err;
      }
      const method = req.query.method ? String(req.query.method) : null;
      const methods = method ? flow.methods.filter((m) => m.name === method) : flow.methods;
      if (method && !methods.length) {
        throw HttpError.notFound('METHOD_NOT_FOUND', `Metodo nao encontrado: ${method}`);
      }
      res.json({
        path: file.path,
        hash: file.hash,
        mtimeMs: file.mtimeMs,
        size: file.size,
        methods,
      });
    }),
  );

  app.put(
    '/api/projects/:id/blocks/flow',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      const body = req.body || {};
      if (body.baseHash === undefined) {
        throw HttpError.badRequest('BASE_HASH_REQUIRED', 'baseHash e obrigatorio');
      }
      if (!body.method || typeof body.method !== 'string') {
        throw HttpError.badRequest('METHOD_REQUIRED', 'Informe o metodo');
      }
      if (!Array.isArray(body.blocks)) {
        throw HttpError.badRequest('BLOCKS_REQUIRED', 'blocks deve ser uma lista');
      }
      const file = await files.readFile(ctx, req.query.path);
      if (body.baseHash !== file.hash) {
        throw HttpError.conflict('CONFLICT', 'O arquivo foi alterado desde a leitura', {
          path: file.path,
          baseHash: body.baseHash,
          currentHash: file.hash,
          currentContent: file.content,
        });
      }
      const next = service.apply(file.content, {
        className: body.className || null,
        method: body.method,
        blocks: body.blocks,
      }, ctx);
      if (next === file.content) {
        res.json({
          path: file.path,
          hash: file.hash,
          mtimeMs: file.mtimeMs,
          size: file.size,
          content: next,
          unchanged: true,
        });
        return;
      }
      const written = await files.writeFile(ctx, file.path, next, file.hash);
      if (hub) hub.publish(ctx.id, 'blocks:saved', { path: file.path, method: body.method, hash: written.hash });
      res.json({ ...written, content: next, unchanged: false });
    }),
  );

  app.post(
    '/api/projects/:id/blocks',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      const body = req.body || {};
      const block = service.createBlockDef(body);
      const scope = body.scope === 'global' ? 'global' : 'project';
      const saved = await service.saveBlock(ctx, block, scope);
      if (hub) hub.publish(ctx.id, 'blocks:created', { id: block.id, scope, path: saved.path });
      res.status(201).json(saved);
    }),
  );
};
