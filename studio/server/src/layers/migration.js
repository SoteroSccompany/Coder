'use strict';

/**
 * Designer de tabela -> arquivo novo em knex/migrations/<timestamp>_<nome>.js
 * no estilo das migrations knex do projeto (exports.up / exports.down + createTable).
 */

const { parseFile } = require('../services/astService');
const { HttpError } = require('../util/httpError');
const { layerBase, exigirTabela, exigirIdent } = require('./caminhos');

const TIPOS = {
  string: 'string',
  text: 'text',
  integer: 'integer',
  bigInteger: 'bigInteger',
  boolean: 'boolean',
  datetime: 'dateTime',
  timestamp: 'timestamp',
  date: 'date',
  json: 'json',
  float: 'float',
  decimal: 'decimal',
};

function dois(n) {
  return String(n).padStart(2, '0');
}

function timestamp(date = new Date()) {
  return (
    `${date.getFullYear()}${dois(date.getMonth() + 1)}${dois(date.getDate())}` +
    `${dois(date.getHours())}${dois(date.getMinutes())}${dois(date.getSeconds())}`
  );
}

function normalizarColunas(columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw HttpError.badRequest('COLUNAS_OBRIGATORIAS', 'Informe ao menos uma coluna');
  }
  const vistos = new Set();
  return columns.map((col) => {
    if (!col || typeof col !== 'object') throw HttpError.badRequest('COLUNA_INVALIDA', 'Coluna invalida');
    const name = exigirIdent(col.name, 'Nome da coluna');
    if (vistos.has(name)) throw HttpError.badRequest('COLUNA_DUPLICADA', `Coluna duplicada: ${name}`);
    vistos.add(name);
    const tipo = TIPOS[col.type];
    if (!tipo) throw HttpError.badRequest('TIPO_COLUNA', `Tipo de coluna desconhecido: ${col.type}`);
    let length = null;
    if (col.length !== undefined && col.length !== null && col.length !== '') {
      length = Number(col.length);
      if (!Number.isInteger(length) || length < 1 || length > 8000) {
        throw HttpError.badRequest('TAMANHO_INVALIDO', `Tamanho invalido na coluna ${name}`);
      }
    }
    return {
      name,
      type: tipo,
      pk: !!col.pk,
      nullable: !!col.nullable,
      length,
    };
  });
}

function linhaColuna(col) {
  const arg = col.length && (col.type === 'string' || col.type === 'decimal')
    ? `'${col.name}', ${col.length}`
    : `'${col.name}'`;
  let linha = `        table.${col.type}(${arg})`;
  if (col.pk) linha += '.notNullable().primary()';
  else linha += col.nullable ? '.nullable()' : '.notNullable()';
  return `${linha};`;
}

function renderMigration({ table, columns }) {
  const linhas = columns.map(linhaColuna).join('\n');
  return `/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const tableName = '${table}';

exports.up = function (knex) {
    return knex.schema.createTable(tableName, function (table) {
${linhas}
    });
};

exports.down = function (knex) {
    return knex.schema.dropTable(tableName);
};
`;
}

async function criarMigration(ctx, files, body) {
  const table = exigirTabela(body && body.table);
  const columns = normalizarColunas(body.columns);
  if (columns.filter((c) => c.pk).length > 1) {
    throw HttpError.badRequest('PK_UNICA', 'Informe no maximo uma coluna como chave primaria');
  }
  const base = layerBase(ctx, 'migration');
  const ts = timestamp();
  const rel = `${base}/${ts}_${table}.js`;
  const content = renderMigration({ table, columns });
  parseFile(content);
  const gravado = await files.writeFile(ctx, rel, content, null);
  return { ...gravado, table, columns };
}

module.exports = { criarMigration, renderMigration, normalizarColunas, timestamp, TIPOS };
