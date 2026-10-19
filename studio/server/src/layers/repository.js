'use strict';

/**
 * Insere um metodo de query knex (insert, update, select, delete, transaction)
 * na classe do repositorio. Nao usa Blockly: o formulario da UI chama este modulo.
 */

const traverse = require('@babel/traverse').default;
const { parseFile, print } = require('../services/astService');
const { HttpError } = require('../util/httpError');
const { exigirIdent, exigirTabela } = require('./caminhos');

const KINDS = new Set(['insert', 'update', 'select', 'delete', 'transaction']);

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

function tabelaDoSuper(ctor) {
  if (!ctor || !ctor.body) return null;
  for (const stmt of ctor.body.body) {
    const e = stmt.type === 'ExpressionStatement' ? stmt.expression : stmt;
    if (!e || e.type !== 'CallExpression') continue;
    if (e.callee.type !== 'Super') continue;
    const arg = e.arguments[0];
    if (!arg || arg.type !== 'ObjectExpression') continue;
    for (const prop of arg.properties) {
      if (prop.type !== 'ObjectProperty') continue;
      const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : null;
      if (key === 'tableName' && prop.value.type === 'StringLiteral') return prop.value.value;
    }
  }
  return null;
}

function lerRepositorio(source) {
  let ast;
  try {
    ast = parseFile(source);
  } catch (err) {
    throw new HttpError(422, 'JS_INVALIDO', `Nao foi possivel ler o repositorio: ${err.message}`);
  }
  const classPath = findClass(ast);
  if (!classPath) throw new HttpError(422, 'SEM_CLASSE', 'Arquivo de repositorio sem classe');
  const classNode = classPath.node;
  const ctor = classNode.body.body.find((m) => m.kind === 'constructor');
  const methods = classNode.body.body
    .filter((m) => m.type === 'ClassMethod' || m.type === 'ClassPrivateMethod')
    .map((m) => ({
      name: methodName(m),
      kind: m.kind,
      async: !!m.async,
    }))
    .filter((m) => m.name);
  return {
    className: classNode.id && classNode.id.name ? classNode.id.name : null,
    tableName: tabelaDoSuper(ctor),
    methods,
  };
}

function corpoMetodo(kind, nome, tabela) {
  switch (kind) {
    case 'insert':
      return `    async ${nome}(data) {
        const response = await knex('${tabela}').insert(data);
        return { status: true, data: response, msg: 'registro inserido' };
    }`;
    case 'update':
      return `    async ${nome}(data) {
        const response = await knex('${tabela}').update(data).where('id', data.id);
        return { status: true, data: response, msg: 'registro atualizado' };
    }`;
    case 'select':
      return `    async ${nome}(filtro) {
        const response = await knex('${tabela}').select('*').where(filtro || {});
        return { status: true, data: response, msg: 'consulta realizada' };
    }`;
    case 'delete':
      return `    async ${nome}(data) {
        const response = await knex('${tabela}').where('id', data.id).del();
        return { status: true, data: response, msg: 'registro removido' };
    }`;
    case 'transaction':
      return `    async ${nome}(data) {
        const trx = await knex.transaction();
        try {
            const response = await trx('${tabela}').insert(data);
            await trx.commit();
            return { status: true, data: response, msg: 'transacao concluida' };
        } catch (error) {
            await trx.rollback();
            return { status: false, error, msg: 'falha na transacao' };
        }
    }`;
    default:
      throw HttpError.badRequest('SNIPPET_INVALIDO', 'Snippet de query desconhecido');
  }
}

function inserirMetodo(source, { kind, name, table }) {
  if (!KINDS.has(kind)) throw HttpError.badRequest('SNIPPET_INVALIDO', 'Use insert, update, select, delete ou transaction');
  const nome = exigirIdent(name, 'Nome do metodo');
  if (nome === 'constructor') throw HttpError.badRequest('NOME_INVALIDO', 'constructor nao pode ser gerado por aqui');
  let ast;
  try {
    ast = parseFile(source);
  } catch (err) {
    throw new HttpError(422, 'JS_INVALIDO', `Nao foi possivel ler o repositorio: ${err.message}`);
  }
  const classPath = findClass(ast);
  if (!classPath) throw new HttpError(422, 'SEM_CLASSE', 'Arquivo de repositorio sem classe');
  const classNode = classPath.node;
  const ja = classNode.body.body.some((m) => methodName(m) === nome);
  if (ja) throw HttpError.conflict('METODO_EXISTE', `O metodo ${nome} ja existe`);
  const ctor = classNode.body.body.find((m) => m.kind === 'constructor');
  const tabela = table ? exigirTabela(table) : tabelaDoSuper(ctor);
  if (!tabela) throw HttpError.badRequest('TABELA_OBRIGATORIA', 'Informe a tabela (o construtor nao declara tableName)');
  exigirTabela(tabela);
  const wrapper = parseFile(`class T {\n${corpoMetodo(kind, nome, tabela)}\n}\n`);
  classNode.body.body.push(wrapper.program.body[0].body.body[0]);
  return { source: print(ast), tableName: tabela, name: nome, kind };
}

module.exports = { lerRepositorio, inserirMetodo, KINDS };
