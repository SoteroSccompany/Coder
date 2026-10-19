'use strict';

/**
 * Caminhos relativos a partir das camadas do manifesto (deps.registry / projectContext).
 * Nao usa path.join com input cru: quem grava passa o relativo para fileService ou resolvePath.
 */

const path = require('path');
const { HttpError } = require('../util/httpError');

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TABELA = /^[A-Za-z_][A-Za-z0-9_]*$/;

function layerBase(ctx, id) {
  const layer = (ctx.layers || []).find((l) => l.id === id);
  if (!layer || !layer.basePath) {
    throw HttpError.badRequest('CAMADA_AUSENTE', `Camada "${id}" nao esta mapeada no projeto`);
  }
  return layer.basePath;
}

function assertNaCamada(ctx, rel, layerId) {
  const layer = ctx.layerOf(rel);
  if (!layer || layer.id !== layerId) {
    throw HttpError.badRequest('CAMADA_ERRADA', `O arquivo nao pertence a camada ${layerId}`);
  }
  return layer;
}

/** Require relativo (POSIX) de `fromFile` ate o modulo `toModule` (sem extensao). */
function relRequire(fromFile, toModule) {
  const fromDir = path.posix.dirname(String(fromFile).replace(/\\/g, '/'));
  const alvo = String(toModule).replace(/\\/g, '/').replace(/\.js$/, '');
  let rel = path.posix.relative(fromDir, alvo);
  if (!rel || rel === '') rel = '.';
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function exigirIdent(valor, rotulo) {
  if (typeof valor !== 'string' || !IDENT.test(valor)) {
    throw HttpError.badRequest('NOME_INVALIDO', `${rotulo} invalido`);
  }
  return valor;
}

function exigirTabela(valor) {
  if (typeof valor !== 'string' || !TABELA.test(valor)) {
    throw HttpError.badRequest('TABELA_INVALIDA', 'Nome de tabela invalido');
  }
  return valor;
}

module.exports = {
  IDENT,
  layerBase,
  assertNaCamada,
  relRequire,
  exigirIdent,
  exigirTabela,
};
