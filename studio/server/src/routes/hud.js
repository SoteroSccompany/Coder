'use strict';

/**
 * Contexto do ponto e Jarvis local.
 * Nao grava o fluxo: a UI confirma a proposta antes do PUT.
 *
 *   POST /api/projects/:id/blocks/contexto   { blocks, params, index }
 *   POST /api/projects/:id/blocks/jarvis     { frase, index }
 */

const { asyncHandler } = require('../util/asyncHandler');
const { HttpError } = require('../util/httpError');
const { montarContexto } = require('../blocks/contexto');
const { propor } = require('../blocks/jarvis');

module.exports = (app, deps) => {
  function biblioteca(ctx) {
    if (!deps.ext.blocks) throw new Error('Servico de blocos indisponivel');
    return deps.ext.blocks.libraryFor(ctx);
  }

  deps.ext.contexto = {
    montar(body, ctx) {
      return montarContexto(body, biblioteca(ctx));
    },
  };
  deps.ext.jarvis = {
    propor(frase, index, ctx) {
      return propor(frase, index, biblioteca(ctx));
    },
  };

  app.post(
    '/api/projects/:id/blocks/contexto',
    asyncHandler(async (req, res) => {
      const ctx = deps.registry.require(req.params.id);
      const body = req.body || {};
      if (!Array.isArray(body.blocks) || body.blocks.some((b) => !b || typeof b !== 'object' || typeof b.id !== 'string')) {
        throw HttpError.badRequest('BLOCKS_REQUIRED', 'blocks deve ser uma lista de placas');
      }
      if (typeof body.index !== 'number' || !Number.isInteger(body.index)) {
        throw HttpError.badRequest('INDEX_INVALIDO', 'index deve ser um inteiro');
      }
      if (body.index < 0 || body.index > body.blocks.length) {
        throw HttpError.badRequest('INDEX_INVALIDO', 'index fora do fluxo');
      }
      if (body.params != null && typeof body.params !== 'string') {
        throw HttpError.badRequest('PARAMS_INVALIDOS', 'params deve ser o texto da assinatura');
      }
      res.json(deps.ext.contexto.montar(body, ctx));
    }),
  );

  app.post(
    '/api/projects/:id/blocks/jarvis',
    asyncHandler(async (req, res) => {
      const ctx = deps.registry.require(req.params.id);
      const body = req.body || {};
      if (typeof body.frase !== 'string') {
        throw HttpError.badRequest('FRASE_OBRIGATORIA', 'Informe a frase');
      }
      if (body.index != null && body.index !== '' && (typeof body.index !== 'number' || !Number.isInteger(body.index))) {
        throw HttpError.badRequest('INDEX_INVALIDO', 'index deve ser um inteiro');
      }
      res.json(deps.ext.jarvis.propor(body.frase, body.index, ctx));
    }),
  );
};
