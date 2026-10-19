'use strict';

const { asyncHandler } = require('../util/asyncHandler');
const { HttpError } = require('../util/httpError');
const { layerBase, assertNaCamada, relRequire } = require('../layers/caminhos');
const { lerDomain, atualizarDomain } = require('../layers/domain');
const { lerRepositorio, inserirMetodo } = require('../layers/repository');
const { lerRotasProjeto, salvarRota } = require('../layers/rotas');
const { listarWorkers, criarWorker } = require('../layers/worker');
const { criarMigration } = require('../layers/migration');
const { criarEntidade } = require('../layers/entidade');

module.exports = (app, deps) => {
  const { registry, files, hub } = deps;

  function ctxDe(req) {
    return registry.require(req.params.id);
  }

  app.get(
    '/api/projects/:id/layers/domain',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      const doc = await files.readFile(ctx, req.query.path);
      assertNaCamada(ctx, doc.path, 'domain');
      res.json({ path: doc.path, hash: doc.hash, mtimeMs: doc.mtimeMs, ...lerDomain(doc.content) });
    }),
  );

  app.put(
    '/api/projects/:id/layers/domain',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      const rel = req.query.path;
      assertNaCamada(ctx, rel, 'domain');
      const doc = await files.readFile(ctx, rel);
      const dateNowRequire = relRequire(doc.path, `${layerBase(ctx, 'gateway')}/functions/data/getToday`);
      const next = atualizarDomain(doc.content, (req.body || {}).fields, { dateNowRequire });
      const gravado = await files.writeFile(ctx, doc.path, next, (req.body || {}).baseHash);
      hub.publish(ctx.id, 'layers:domain', { path: gravado.path, hash: gravado.hash });
      res.json({ ...gravado, ...lerDomain(next) });
    }),
  );

  app.get(
    '/api/projects/:id/layers/repository',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      const doc = await files.readFile(ctx, req.query.path);
      assertNaCamada(ctx, doc.path, 'repository');
      res.json({ path: doc.path, hash: doc.hash, mtimeMs: doc.mtimeMs, ...lerRepositorio(doc.content) });
    }),
  );

  app.post(
    '/api/projects/:id/layers/repository/metodo',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      const rel = req.query.path;
      assertNaCamada(ctx, rel, 'repository');
      const doc = await files.readFile(ctx, rel);
      const body = req.body || {};
      const gerado = inserirMetodo(doc.content, { kind: body.kind, name: body.name, table: body.table });
      const gravado = await files.writeFile(ctx, doc.path, gerado.source, body.baseHash);
      res.json({ ...gravado, name: gerado.name, kind: gerado.kind, tableName: gerado.tableName });
    }),
  );

  app.get(
    '/api/projects/:id/layers/rotas',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      res.json(await lerRotasProjeto(ctx, files));
    }),
  );

  app.post(
    '/api/projects/:id/layers/rotas',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      const gravado = await salvarRota(ctx, files, req.body || {});
      hub.publish(ctx.id, 'layers:rotas', { path: gravado.path, hash: gravado.hash });
      res.json(gravado);
    }),
  );

  app.get(
    '/api/projects/:id/layers/workers',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      res.json({ workers: await listarWorkers(ctx) });
    }),
  );

  app.post(
    '/api/projects/:id/layers/workers',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      const body = req.body || {};
      if (body.baseHash !== null && body.baseHash !== undefined) {
        throw new HttpError(400, 'BASE_HASH_REQUIRED', 'Consumidor novo usa baseHash null');
      }
      const gravado = await criarWorker(ctx, files, body);
      hub.publish(ctx.id, 'layers:worker', { path: gravado.path });
      res.status(201).json(gravado);
    }),
  );

  app.post(
    '/api/projects/:id/layers/migrations',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      const gravado = await criarMigration(ctx, files, req.body || {});
      hub.publish(ctx.id, 'layers:migration', { path: gravado.path });
      res.status(201).json(gravado);
    }),
  );

  app.post(
    '/api/projects/:id/layers/entidade',
    asyncHandler(async (req, res) => {
      const ctx = ctxDe(req);
      const criado = await criarEntidade(ctx, files, req.body || {});
      hub.publish(ctx.id, 'layers:entidade', { entity: criado.entity, arquivos: criado.arquivos.map((a) => a.path) });
      res.status(201).json(criado);
    }),
  );
};
