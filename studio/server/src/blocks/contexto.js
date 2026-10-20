'use strict';

/**
 * Contexto de um ponto do fluxo.
 *
 * Percorre as placas anteriores, gera o snippet de cada uma (generate.js)
 * e tira os identificadores com o mesmo parser do astService.
 * `produz` do .block.json entra quando o slot existe: o nome declarado
 * e o valor do slot (ex.: variavel = "user").
 */

const traverse = require('@babel/traverse').default;
const { parseFile } = require('../services/astService');
const { emitNode } = require('./generate');

const IDENT = /^[A-Za-z_$][\w$]*$/;

function mapa(library) {
  if (!library) return new Map();
  if (library instanceof Map) return library;
  return new Map(library.map((b) => [b.id, b]));
}

function juntar(destino, nomes) {
  for (const nome of nomes) {
    if (!nome || !IDENT.test(nome) || destino.includes(nome)) continue;
    destino.push(nome);
  }
  return destino;
}

function coletarId(node, destino, vistos) {
  if (!node) return;
  if (node.type === 'Identifier') {
    if (node.name === '__hud' || node.name === '__p__') return;
    if (!vistos.has(node.name)) {
      vistos.add(node.name);
      destino.push(node.name);
    }
    return;
  }
  if (node.type === 'RestElement') return coletarId(node.argument, destino, vistos);
  if (node.type === 'AssignmentPattern') return coletarId(node.left, destino, vistos);
  if (node.type === 'ObjectPattern') {
    for (const prop of node.properties || []) {
      if (!prop) continue;
      if (prop.type === 'RestElement') coletarId(prop.argument, destino, vistos);
      else if (prop.type === 'ObjectProperty') coletarId(prop.value, destino, vistos);
    }
    return;
  }
  if (node.type === 'ArrayPattern') {
    for (const el of node.elements || []) coletarId(el, destino, vistos);
  }
}

/** Parametros do metodo, na ordem em que aparecem na assinatura. */
function nomesDeParams(params) {
  const texto = String(params || '').trim();
  if (!texto) return [];
  let ast;
  try {
    ast = parseFile(`function __p__(${texto}) {}`);
  } catch {
    return [];
  }
  const fn = ast.program && ast.program.body && ast.program.body[0];
  if (!fn || !fn.params) return [];
  const nomes = [];
  const vistos = new Set();
  for (const p of fn.params) coletarId(p, nomes, vistos);
  return nomes.filter((n) => IDENT.test(n));
}

function tentarParse(codigo) {
  try {
    return parseFile(codigo);
  } catch {
    /* tenta como corpo de funcao */
  }
  try {
    return parseFile(`async function __hud() {\n${codigo}\n}`);
  } catch {
    return null;
  }
}

/** Bindings declarados e identificadores lidos num trecho de JS. */
function analisar(codigo) {
  const src = String(codigo || '').trim();
  if (!src) return { declarados: [], refs: [] };
  const ast = tentarParse(src);
  if (!ast) return { declarados: [], refs: [] };
  const declarados = [];
  const refs = [];
  const vistosD = new Set();
  const vistosR = new Set();
  traverse(ast, {
    noScope: true,
    VariableDeclarator(p) {
      coletarId(p.node.id, declarados, vistosD);
    },
    FunctionDeclaration(p) {
      if (p.node.id) coletarId(p.node.id, declarados, vistosD);
    },
    ClassDeclaration(p) {
      if (p.node.id) coletarId(p.node.id, declarados, vistosD);
    },
    CatchClause(p) {
      coletarId(p.node.param, declarados, vistosD);
    },
    Identifier(p) {
      if (p.node.name === '__hud' || p.node.name === '__p__') return;
      if (typeof p.isReferencedIdentifier === 'function' && p.isReferencedIdentifier()) {
        if (!vistosR.has(p.node.name)) {
          vistosR.add(p.node.name);
          refs.push(p.node.name);
        }
      }
    },
  });
  return {
    declarados: declarados.filter((n) => IDENT.test(n)),
    refs: refs.filter((n) => IDENT.test(n)),
  };
}

function snippetDe(node, lib) {
  if (!node) return '';
  try {
    return emitNode(node, lib, 0, '\n');
  } catch {
    return '';
  }
}

/**
 * Nomes de `produz` no .block.json.
 * Se a entrada e um slot (ou `{{slot}}`), so entra quando o slot tem valor,
 * e o nome devolvido e esse valor. Nome fixo entra direto.
 */
function nomesProduzidos(node, def) {
  const lista = def && Array.isArray(def.produz) ? def.produz : [];
  const slots = (node && node.slots) || {};
  const nomesSlots = new Set(
    (def && Array.isArray(def.slots) ? def.slots : []).map((s) => s && s.name).filter(Boolean),
  );
  const out = [];
  for (const item of lista) {
    const bruto = String(item || '').trim();
    if (!bruto) continue;
    const slot = bruto.replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
    const referenciaSlot = bruto.includes('{{') || nomesSlots.has(slot);
    if (referenciaSlot || Object.prototype.hasOwnProperty.call(slots, slot)) {
      if (!Object.prototype.hasOwnProperty.call(slots, slot)) continue;
      const valor = slots[slot];
      if (valor == null || String(valor).trim() === '') continue;
      const nome = String(valor).trim();
      if (IDENT.test(nome)) out.push(nome);
      continue;
    }
    if (IDENT.test(bruto)) out.push(bruto);
  }
  return out;
}

function resumo(node, lib) {
  const def = node && lib.get(node.id);
  const lido = analisar(snippetDe(node, lib));
  return {
    declarados: juntar([], [...lido.declarados, ...nomesProduzidos(node, def)]),
    refs: lido.refs,
  };
}

/**
 * @param {{ blocks?: object[], params?: string, index?: number }} body
 * @param {Array<object>|Map<string, object>} library
 * @returns {{ params: string[], declarados: string[], le: string[], produz: string[] }}
 */
function montarContexto(body, library) {
  const blocks = Array.isArray(body && body.blocks) ? body.blocks : [];
  const index = body && body.index != null ? body.index : 0;
  const lib = mapa(library);
  const anteriores = blocks.slice(0, Math.max(0, index));
  const atual = index >= 0 && index < blocks.length ? blocks[index] : null;
  const declarados = [];
  for (const node of anteriores) juntar(declarados, resumo(node, lib).declarados);
  const doAtual = atual ? resumo(atual, lib) : { declarados: [], refs: [] };
  return {
    params: nomesDeParams(body && body.params),
    declarados,
    le: doAtual.refs,
    produz: doAtual.declarados,
  };
}

module.exports = {
  montarContexto,
  nomesDeParams,
  analisar,
  nomesProduzidos,
};
