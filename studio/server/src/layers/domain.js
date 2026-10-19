'use strict';

/**
 * Le e reescreve o construtor e o metodo getX() de um domain.
 * O restante da classe (setX, outros metodos, requires) fica nos nos originais do recast.
 */

const recast = require('recast');
const traverse = require('@babel/traverse').default;
const { parseFile, print } = require('../services/astService');
const { HttpError } = require('../util/httpError');
const { exigirIdent } = require('./caminhos');

const KINDS = new Set(['plain', 'uuid', 'dateNow', 'boolean', 'custom']);

function squash(code) {
  return String(code).replace(/\s+/g, '');
}

function findClass(ast) {
  let found = null;
  traverse(ast, {
    noScope: true,
    Class(p) {
      if (!found) found = p;
    },
  });
  return found;
}

function methodName(m) {
  if (!m || !m.key) return null;
  if (m.key.type === 'Identifier') return m.key.name;
  if (m.key.type === 'StringLiteral') return m.key.value;
  return null;
}

function paramNome(ctor) {
  const p = ctor && ctor.params && ctor.params[0];
  if (p && p.type === 'Identifier' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name)) return p.name;
  return 'data';
}

function atribuicaoThis(stmt) {
  if (!stmt || stmt.type !== 'ExpressionStatement') return null;
  const e = stmt.expression;
  if (!e || e.type !== 'AssignmentExpression' || e.operator !== '=') return null;
  const l = e.left;
  if (!l || l.type !== 'MemberExpression' || l.computed) return null;
  if (l.object.type !== 'ThisExpression') return null;
  if (l.property.type !== 'Identifier') return null;
  return l.property.name;
}

function classificar(fieldName, rhsNode, param) {
  const bruto = recast.print(rhsNode).code.trim();
  const code = squash(bruto);
  const n = fieldName;
  const p = param;
  if (code === squash(`${p}.${n} ? ${p}.${n} : uuid.v4()`)) return { kind: 'uuid' };
  if (code === squash(`${p}.${n} ? ${p}.${n} : dateNow()`)) return { kind: 'dateNow' };
  if (code === squash(`${p}.${n} === true || ${p}.${n} === false ? ${p}.${n} : false`)) return { kind: 'boolean' };
  if (code === squash(`${p}.${n}`)) return { kind: 'plain' };
  return { kind: 'custom', expression: bruto };
}

function parseOu422(source) {
  try {
    return parseFile(source);
  } catch (err) {
    throw new HttpError(422, 'JS_INVALIDO', `Nao foi possivel ler o JavaScript: ${err.message}`);
  }
}

function expressaoCampo(field, param) {
  const n = field.name;
  const p = param;
  switch (field.kind) {
    case 'uuid':
      return `${p}.${n} ? ${p}.${n} : uuid.v4()`;
    case 'dateNow':
      return `${p}.${n} ? ${p}.${n} : dateNow()`;
    case 'boolean':
      return `${p}.${n} === true || ${p}.${n} === false ? ${p}.${n} : false`;
    case 'plain':
      return `${p}.${n}`;
    case 'custom': {
      if (typeof field.expression !== 'string' || !field.expression.trim()) {
        throw HttpError.badRequest('EXPRESSAO_OBRIGATORIA', `Campo ${n} do tipo custom precisa de expression`);
      }
      const expr = field.expression.trim();
      if (/[;{}]/.test(expr) || expr.includes('\n')) {
        throw HttpError.badRequest('EXPRESSAO_INVALIDA', `Expressao do campo ${n} deve ser uma unica expressao`);
      }
      try {
        parseFile(`void (${expr});`);
      } catch {
        throw HttpError.badRequest('EXPRESSAO_INVALIDA', `Expressao invalida no campo ${n}`);
      }
      return expr;
    }
    default:
      throw HttpError.badRequest('TIPO_CAMPO', `Tipo de campo desconhecido: ${field.kind}`);
  }
}

function stmtDe(codigo) {
  return parseFile(codigo).program.body[0];
}

function temBinding(ast, nome) {
  let achou = false;
  traverse(ast, {
    noScope: true,
    VariableDeclarator(p) {
      if (p.node.id.type === 'Identifier' && p.node.id.name === nome) achou = true;
    },
  });
  return achou;
}

function garantirRequire(ast, local, modulo) {
  if (temBinding(ast, local)) return;
  const stmt = stmtDe(`const ${local} = require(${JSON.stringify(modulo)});`);
  ast.program.body.unshift(stmt);
}

function nomeGetter(classNode) {
  const existente = classNode.body.body.find((m) => {
    const n = methodName(m);
    return m.kind === 'method' && n && /^get[A-Za-z_]/.test(n);
  });
  if (existente) return methodName(existente);
  const className = classNode.id && classNode.id.name;
  const base = className && className.endsWith('Domain') ? className.slice(0, -'Domain'.length) : className || 'Entidade';
  return `get${base}`;
}

function lerDomain(source) {
  const ast = parseOu422(source);
  const classPath = findClass(ast);
  if (!classPath) throw new HttpError(422, 'SEM_CLASSE', 'Arquivo de domain sem classe');
  const classNode = classPath.node;
  const ctor = classNode.body.body.find((m) => m.kind === 'constructor');
  const param = paramNome(ctor);
  const fields = [];
  if (ctor && ctor.body && Array.isArray(ctor.body.body)) {
    for (const stmt of ctor.body.body) {
      const name = atribuicaoThis(stmt);
      if (!name) continue;
      fields.push({ name, ...classificar(name, stmt.expression.right, param) });
    }
  }
  return {
    className: classNode.id && classNode.id.name ? classNode.id.name : null,
    getter: nomeGetter(classNode),
    param,
    fields,
  };
}

function normalizarCampos(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw HttpError.badRequest('CAMPOS_OBRIGATORIOS', 'Informe ao menos um campo');
  }
  const vistos = new Set();
  return fields.map((f) => {
    if (!f || typeof f !== 'object') throw HttpError.badRequest('CAMPO_INVALIDO', 'Campo invalido');
    const name = exigirIdent(f.name, 'Nome do campo');
    if (name === 'constructor' || name === 'prototype') {
      throw HttpError.badRequest('CAMPO_INVALIDO', `Nome de campo reservado: ${name}`);
    }
    if (!KINDS.has(f.kind)) throw HttpError.badRequest('TIPO_CAMPO', `Tipo de campo desconhecido: ${f.kind}`);
    if (vistos.has(name)) throw HttpError.badRequest('CAMPO_DUPLICADO', `Campo duplicado: ${name}`);
    vistos.add(name);
    return { name, kind: f.kind, expression: f.expression };
  });
}

/**
 * Atualiza construtor e getX(). `dateNowRequire` e o caminho do require de dateNow
 * (so e inserido se algum campo usar esse tipo e o binding ainda nao existir).
 */
function atualizarDomain(source, fields, { dateNowRequire } = {}) {
  const lista = normalizarCampos(fields);
  const ast = parseOu422(source);
  const classPath = findClass(ast);
  if (!classPath) throw new HttpError(422, 'SEM_CLASSE', 'Arquivo de domain sem classe');
  const classNode = classPath.node;
  let ctor = classNode.body.body.find((m) => m.kind === 'constructor');
  const param = paramNome(ctor);
  const assigns = lista.map((f) => stmtDe(`this.${f.name} = ${expressaoCampo(f, param)};`));

  if (!ctor) {
    const corpo = lista.map((f) => `        this.${f.name} = ${expressaoCampo(f, param)};`).join('\n');
    const wrapper = parseFile(`class T {\n    constructor(${param}) {\n${corpo}\n    }\n}\n`);
    ctor = wrapper.program.body[0].body.body[0];
    classNode.body.body.unshift(ctor);
  } else {
    const mantidos = ctor.body.body.filter((stmt) => !atribuicaoThis(stmt));
    ctor.body.body = [...mantidos, ...assigns];
  }

  const gName = nomeGetter(classNode);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(gName)) {
    throw HttpError.badRequest('GETTER_INVALIDO', 'Nao foi possivel determinar o metodo getX()');
  }
  const props = lista.map((f) => `            ${f.name}: this.${f.name},`).join('\n');
  const getterAst = parseFile(
    `class T {\n    ${gName}() {\n        return {\n${props}\n        };\n    }\n}\n`,
  );
  const novoGetter = getterAst.program.body[0].body.body[0];
  const idx = classNode.body.body.findIndex((m) => m.kind === 'method' && methodName(m) === gName);
  if (idx === -1) {
    const ctorIdx = classNode.body.body.findIndex((m) => m.kind === 'constructor');
    classNode.body.body.splice(ctorIdx + 1, 0, novoGetter);
  } else {
    classNode.body.body[idx] = novoGetter;
  }

  if (lista.some((f) => f.kind === 'uuid')) garantirRequire(ast, 'uuid', 'uuid');
  if (lista.some((f) => f.kind === 'dateNow')) {
    garantirRequire(ast, 'dateNow', dateNowRequire || '../../infrastructure/gateways/functions/data/getToday');
  }
  return print(ast);
}

module.exports = {
  lerDomain,
  atualizarDomain,
  normalizarCampos,
  expressaoCampo,
};
