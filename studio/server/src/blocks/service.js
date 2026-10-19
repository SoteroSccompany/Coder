'use strict';

/**
 * Fachada da fase de blocos. Pendurada em `deps.ext.blocks` pelas rotas.
 */

const fs = require('fs');
const path = require('path');
const { loadLibrary, DEFAULT_GLOBAL_DIR, toPublic } = require('./library');
const { decomposeSource } = require('./decompose');
const { applyFlow } = require('./generate');
const { createBlockDef, fileSlug, CATEGORIA_RE } = require('./creator');
const { HttpError } = require('../util/httpError');

function createBlockService(deps) {
  const ast = deps.ast;
  const files = deps.files;
  const globalDir = (deps.config && deps.config.blocksDir) || DEFAULT_GLOBAL_DIR;

  function libraryFor(ctx) {
    return loadLibrary(ctx || null, { globalDir });
  }

  function decompose(source, ctx) {
    return decomposeSource(source, libraryFor(ctx), ast.parseFile);
  }

  function apply(source, spec, ctx) {
    try {
      return applyFlow(source, spec, libraryFor(ctx), ast.parseFile);
    } catch (err) {
      if (err.code === 'METHOD_NOT_FOUND') {
        throw HttpError.notFound('METHOD_NOT_FOUND', err.message);
      }
      if (err instanceof SyntaxError) {
        throw HttpError.badRequest('GENERATED_SYNTAX', `O fluxo gerou JavaScript invalido: ${err.message}`);
      }
      throw err;
    }
  }

  async function saveBlock(ctx, block, scope) {
    const categoria = block.categoria;
    if (!CATEGORIA_RE.test(categoria)) throw HttpError.badRequest('CATEGORIA_INVALIDA', 'categoria invalida');
    const slug = fileSlug(block.id);
    const json = `${JSON.stringify(block, null, 2)}\n`;
    if (scope === 'global') {
      const dir = path.resolve(globalDir, categoria);
      const abs = path.resolve(dir, slug);
      const rel = path.relative(path.resolve(globalDir), abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw HttpError.forbidden('PATH_TRAVERSAL', 'Caminho de bloco invalido');
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(abs, json, 'utf8');
      return { path: rel.split(path.sep).join('/'), scope: 'global', block };
    }
    if (!ctx) throw HttpError.badRequest('PROJECT_REQUIRED', 'Projeto obrigatorio para escopo project');
    const rel = `.studio/blocks/${categoria}/${slug}`;
    let baseHash = null;
    try {
      const cur = await files.readFile(ctx, rel);
      baseHash = cur.hash;
    } catch (err) {
      if (!err || err.status !== 404) throw err;
    }
    const written = await files.writeFile(ctx, rel, json, baseHash);
    return { ...written, scope: 'project', block };
  }

  return {
    libraryFor,
    decompose,
    apply,
    createBlockDef,
    saveBlock,
    toPublic,
    globalDir,
  };
}

module.exports = { createBlockService };
