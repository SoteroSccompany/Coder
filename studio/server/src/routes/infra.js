'use strict';

const fs = require('fs');
const yaml = require('yaml');
const { asyncHandler } = require('../util/asyncHandler');
const { HttpError } = require('../util/httpError');
const { listarCatalogo } = require('../infra/catalogo');
const { adicionarServico, COMPOSE } = require('../infra/servicos');
const {
  slugDo,
  servicoOpcional,
  cauda,
  argsUp,
  argsDown,
  argsLogs,
  argsNpm,
  runProcess,
  exigirBinario,
  caminhoCompose,
  checarSaude,
} = require('../infra/operacao');

module.exports = (app, deps) => {
  const { registry, files, hub } = deps;

  function runner() {
    return deps.ext.infraRunner || runProcess;
  }

  function publicar(ctx, level, message) {
    hub.publish(ctx.id, 'log:line', { level, message, source: 'infra' });
  }

  async function rodar(ctx, spec) {
    const resultado = exigirBinario(await runner()(spec.cmd, spec.args, { cwd: ctx.rootPath, timeoutMs: spec.timeoutMs }), spec.cmd);
    const ok = resultado.code === 0;
    publicar(ctx, ok ? 'info' : 'warn', `${spec.cmd} ${spec.args.join(' ')} (codigo ${resultado.code})`);
    return {
      ok,
      code: resultado.code,
      stdout: resultado.stdout,
      stderr: resultado.stderr,
      comando: [spec.cmd, ...spec.args],
    };
  }

  function exigirCompose(ctx) {
    const { rel, abs } = caminhoCompose(ctx);
    if (!fs.existsSync(abs)) {
      throw HttpError.notFound('COMPOSE_AUSENTE', 'O projeto ainda nao tem docker-compose.yaml. Adicione um servico do catalogo.');
    }
    return { rel, abs };
  }

  app.get(
    '/api/projects/:id/infra/catalogo',
    asyncHandler(async (req, res) => {
      registry.require(req.params.id);
      res.json({ catalogo: listarCatalogo() });
    }),
  );

  app.get(
    '/api/projects/:id/infra/servicos',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      let nomes = [];
      try {
        const doc = await files.readFile(ctx, COMPOSE);
        const parsed = yaml.parse(doc.content) || {};
        nomes = parsed.services ? Object.keys(parsed.services) : [];
      } catch (err) {
        if (!(err instanceof HttpError) || err.status !== 404) throw err;
      }
      res.json({ compose: COMPOSE, servicos: nomes });
    }),
  );

  app.post(
    '/api/projects/:id/infra/servicos',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      const id = req.body && req.body.id;
      const resultado = await adicionarServico(ctx, files, id);
      publicar(ctx, 'info', `Servico ${resultado.id} ${resultado.jaExistia ? 'ja estava' : 'incluido'} no compose do projeto`);
      res.status(resultado.jaExistia ? 200 : 201).json(resultado);
    }),
  );

  app.post(
    '/api/projects/:id/infra/up',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      const { abs } = exigirCompose(ctx);
      const spec = argsUp(slugDo(ctx), abs, servicoOpcional(req.body && req.body.servico));
      res.json(await rodar(ctx, spec));
    }),
  );

  app.post(
    '/api/projects/:id/infra/down',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      const { abs } = exigirCompose(ctx);
      res.json(await rodar(ctx, argsDown(slugDo(ctx), abs)));
    }),
  );

  app.get(
    '/api/projects/:id/infra/logs',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      const { abs } = exigirCompose(ctx);
      const spec = argsLogs(slugDo(ctx), abs, cauda(req.query.tail), servicoOpcional(req.query.servico));
      res.json(await rodar(ctx, spec));
    }),
  );

  app.post(
    '/api/projects/:id/infra/migrate',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      res.json(await rodar(ctx, argsNpm(ctx.rootPath, 'migrate')));
    }),
  );

  app.post(
    '/api/projects/:id/infra/test',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      res.json(await rodar(ctx, argsNpm(ctx.rootPath, 'test')));
    }),
  );

  app.get(
    '/api/projects/:id/infra/health',
    asyncHandler(async (req, res) => {
      const ctx = registry.require(req.params.id);
      const saude = await checarSaude(ctx);
      publicar(ctx, saude.ok ? 'info' : 'warn', `Healthcheck ${saude.url}: ${saude.ok ? saude.status : saude.error || saude.status}`);
      res.json(saude);
    }),
  );
};
