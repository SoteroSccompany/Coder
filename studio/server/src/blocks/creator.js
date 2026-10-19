'use strict';

/**
 * "Transformar selecao em bloco": o trecho vira template com `{{param}}`
 * e um pattern de AST. O pattern e conferido contra o proprio trecho
 * antes de gravar — se nao reconhecer, a criacao falha.
 */

const { parseFile } = require('../services/astService');
const { decomposeSource } = require('./decompose');
const { HttpError } = require('../util/httpError');

const SKIP_KEYS = new Set([
  'loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments',
  'comments', 'tokens', 'sourceType', 'interpreter', 'errors', 'program', 'innerComments',
]);

const ID_RE = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CATEGORIA_RE = /^[a-z0-9-]+$/;

function slotToken(name) {
  return `__slot_${name}__`;
}

function containerToken(name) {
  return `__container_${name}__`;
}

function parseSnippet(code) {
  try {
    const ast = parseFile(code);
    if (ast.program.body.length) return ast.program.body;
  } catch {
    /* tenta como corpo de funcao */
  }
  const wrapped = `async function __s__() {\n${code}\n}`;
  const ast = parseFile(wrapped);
  const fn = ast.program.body[0];
  if (!fn || !fn.body) throw new Error('Trecho invalido');
  return fn.body.body;
}

function nodeToPattern(node) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'Identifier' && typeof node.name === 'string') {
    const slot = node.name.match(/^__slot_(.+)__$/);
    if (slot) return { $bind: slot[1], $as: 'expr' };
  }
  if (node.type === 'BlockStatement' && node.body && node.body.length === 1) {
    const only = node.body[0];
    if (
      only.type === 'ExpressionStatement'
      && only.expression
      && only.expression.type === 'Identifier'
    ) {
      const box = String(only.expression.name).match(/^__container_(.+)__$/);
      if (box) return { $container: box[1] };
    }
  }
  const pat = { type: node.type };
  for (const [k, v] of Object.entries(node)) {
    if (SKIP_KEYS.has(k) || v === undefined) continue;
    if (v === null) {
      pat[k] = null;
      continue;
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      pat[k] = v;
      continue;
    }
    if (Array.isArray(v)) {
      pat[k] = v.map((item) => (item && item.type ? nodeToPattern(item) : item));
      continue;
    }
    if (v && v.type) pat[k] = nodeToPattern(v);
  }
  return pat;
}

function derive(code, params) {
  const ordered = [...params].sort((a, b) => b.start - a.start);
  let template = code;
  let skeleton = code;
  for (const p of ordered) {
    const tok = p.tipo === 'container' ? `{{#${p.name}}}` : `{{${p.name}}}`;
    const sk = p.tipo === 'container' ? `{ ${containerToken(p.name)}; }` : slotToken(p.name);
    template = template.slice(0, p.start) + tok + template.slice(p.end);
    skeleton = skeleton.slice(0, p.start) + sk + skeleton.slice(p.end);
  }
  let body;
  try {
    body = parseSnippet(skeleton);
  } catch (err) {
    throw HttpError.badRequest('SELECAO_INVALIDA', `O trecho com parametros nao e JavaScript valido: ${err.message}`);
  }
  if (!body.length) throw HttpError.badRequest('SELECAO_VAZIA', 'O trecho nao tem statements');
  const pattern = body.length === 1 ? nodeToPattern(body[0]) : { sequence: body.map(nodeToPattern) };
  return { template, pattern };
}

function createBlockDef(input) {
  const code = input && typeof input.code === 'string' ? input.code : '';
  if (!code.trim()) throw HttpError.badRequest('CODE_REQUIRED', 'Informe o trecho de codigo');
  const id = String(input.id || '').trim();
  const label = String(input.label || '').trim();
  const categoria = String(input.categoria || '').trim();
  if (!ID_RE.test(id)) throw HttpError.badRequest('ID_INVALIDO', 'id deve ser categoria.nome (letras minusculas, numeros e hifen)');
  if (!label) throw HttpError.badRequest('LABEL_REQUIRED', 'Informe o nome do bloco');
  if (!CATEGORIA_RE.test(categoria)) throw HttpError.badRequest('CATEGORIA_INVALIDA', 'categoria invalida');
  if (!id.startsWith(`${categoria}.`)) {
    throw HttpError.badRequest('ID_CATEGORIA', 'O id deve comecar com a categoria seguida de ponto');
  }
  const params = Array.isArray(input.params) ? input.params : [];
  const ranges = [];
  for (const p of params) {
    const name = String(p.name || '').trim();
    const start = Number(p.start);
    const end = Number(p.end);
    if (!NAME_RE.test(name)) throw HttpError.badRequest('PARAM_INVALIDO', `Nome de parametro invalido: ${name}`);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > code.length || start >= end) {
      throw HttpError.badRequest('PARAM_INTERVALO', `Intervalo invalido para ${name}`);
    }
    ranges.push({ name, start, end, tipo: p.tipo === 'container' ? 'container' : 'expressao', label: p.label || name });
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].start < ranges[i - 1].end) throw HttpError.badRequest('PARAM_SOBREPOSTO', 'Parametros se sobrepoem');
  }
  const { template, pattern } = derive(code, ranges);
  const containers = ranges
    .filter((p) => p.tipo === 'container')
    .map((p) => ({ name: p.name, label: p.label }));
  const extra = Array.isArray(input.containers) ? input.containers : [];
  for (const c of extra) {
    if (c && c.name && !containers.some((x) => x.name === c.name)) containers.push({ name: c.name, label: c.label || c.name });
  }
  const block = {
    id,
    label,
    categoria,
    icone: input.icone || 'code',
    priority: 200,
    slots: ranges
      .filter((p) => p.tipo !== 'container')
      .map((p) => ({ name: p.name, tipo: 'expressao', direcao: 'entrada', label: p.label })),
    imports: Array.isArray(input.imports) ? input.imports.filter((i) => i && i.local && i.source) : [],
    template,
    pattern,
    containers,
    geracao: null,
  };
  const library = [block, { id: 'livre.codigo-livre', label: 'Codigo livre', template: '{{codigo}}', pattern: null }];
  let flow;
  try {
    const wrapped = `class __T {\n  async __m() {\n${code}\n  }\n}\n`;
    flow = decomposeSource(wrapped, library, parseFile);
  } catch (err) {
    throw HttpError.badRequest('SELECAO_INVALIDA', `Nao foi possivel analisar o trecho: ${err.message}`);
  }
  const method = flow.methods.find((m) => m.name === '__m');
  const ok = method && method.blocks.length === 1 && method.blocks[0].id === id;
  if (!ok) {
    throw HttpError.badRequest(
      'PATTERN_MISMATCH',
      'O pattern gerado nao reconheceu o trecho original. Marque expressoes completas (nao pedacos de token).',
    );
  }
  return block;
}

function fileSlug(id) {
  const parts = id.split('.');
  const name = parts.slice(1).join('.') || id;
  if (!/^[a-z0-9.-]+$/.test(name)) throw HttpError.badRequest('ID_INVALIDO', 'Nome de arquivo invalido');
  return `${name}.block.json`;
}

module.exports = {
  createBlockDef,
  derive,
  nodeToPattern,
  fileSlug,
  parseSnippet,
  ID_RE,
  CATEGORIA_RE,
};
