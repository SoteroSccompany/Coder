'use strict';

/**
 * Insere um servico no docker-compose.yaml DO PROJETO sem reescrever o arquivo.
 *
 * A lib `yaml` valida o resultado (parse). Ela nao reimprime o documento:
 * `Document.toString()` pode reformatar e soltar comentarios. A insercao e
 * textual, no fim do bloco `services:`, copiando o restante byte a byte.
 * Comentarios, aspas e a ordem dos servicos existentes permanecem.
 *
 * Este modulo nunca aponta para o compose da raiz do workspace.
 */

const yaml = require('yaml');
const { HttpError } = require('../util/httpError');

function fimDeLinha(texto) {
  return texto.includes('\r\n') ? '\r\n' : '\n';
}

function parseSeguro(texto) {
  try {
    return yaml.parse(texto);
  } catch (err) {
    throw new HttpError(422, 'COMPOSE_INVALIDO', `docker-compose.yaml invalido: ${err.message}`);
  }
}

function indentacaoDosServicos(linhas, servicesIdx) {
  for (let i = servicesIdx + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim() || /^\s*#/.test(linha)) continue;
    if (/^[A-Za-z]/.test(linha)) break;
    const m = linha.match(/^([ \t]+)[A-Za-z0-9_-]+:/);
    if (m) return m[1];
  }
  return '  ';
}

function reindentar(bloco, unidade) {
  const unit = unidade || '  ';
  return bloco
    .split('\n')
    .map((linha) => {
      if (!linha.trim()) return '';
      const espacos = (linha.match(/^ */) || ['  '])[0].length;
      const nivel = Math.max(1, Math.round(espacos / 2));
      return unit + '  '.repeat(nivel - 1) + linha.trim();
    })
    .join('\n');
}

function proximaChaveRaiz(linhas, desde) {
  for (let i = desde; i < linhas.length; i++) {
    if (/^[A-Za-z]/.test(linhas[i])) return i;
  }
  return linhas.length;
}

/**
 * @returns {{ texto: string, jaExistia: boolean }}
 */
function inserirServico(textoOriginal, id, blocoYaml) {
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
    throw HttpError.badRequest('SERVICO_INVALIDO', 'Id de servico invalido');
  }
  const original = textoOriginal == null ? '' : String(textoOriginal);
  const doc = original.trim() ? parseSeguro(original) : {};
  const services = (doc && doc.services) || {};
  if (services && Object.prototype.hasOwnProperty.call(services, id)) {
    return { texto: original.endsWith('\n') || original === '' ? original : `${original}\n`, jaExistia: true };
  }

  const eol = fimDeLinha(original);
  if (!original.trim()) {
    const novo = `# Compose do projeto — gerado pelo Coder Studio${eol}services:${eol}${blocoYaml}${eol}`;
    parseSeguro(novo);
    return { texto: novo, jaExistia: false };
  }

  const linhas = original.split(/\r?\n/);
  let servicesIdx = linhas.findIndex((l) => /^services:\s*(#.*)?$/.test(l) || /^services:\s*\{\s*\}\s*(#.*)?$/.test(l));
  if (servicesIdx === -1) {
    const base = original.endsWith('\n') ? original : `${original}${eol}`;
    const novo = `${base}services:${eol}${blocoYaml}${eol}`;
    parseSeguro(novo);
    return { texto: novo, jaExistia: false };
  }

  const inlineVazio = /^services:\s*\{\s*\}/.test(linhas[servicesIdx]);
  const unidade = inlineVazio ? '  ' : indentacaoDosServicos(linhas, servicesIdx);
  const bloco = reindentar(blocoYaml, unidade);
  if (inlineVazio) {
    linhas.splice(servicesIdx, 1, 'services:', ...bloco.split('\n'));
  } else {
    const fim = proximaChaveRaiz(linhas, servicesIdx + 1);
    const antes = linhas.slice(0, fim);
    while (antes.length && antes[antes.length - 1].trim() === '') antes.pop();
    const inserido = [...antes, '', ...bloco.split('\n')];
    linhas.splice(0, linhas.length, ...inserido, ...linhas.slice(fim));
  }

  let novo = linhas.join(eol);
  if (original.endsWith('\n') || original.endsWith('\r\n')) {
    if (!novo.endsWith('\n')) novo += eol;
  } else if (!novo.endsWith('\n')) {
    novo += eol;
  }
  parseSeguro(novo);
  const conferido = parseSeguro(novo);
  if (!conferido.services || !conferido.services[id]) {
    throw new HttpError(500, 'COMPOSE_INSERCAO', 'O servico nao apareceu no compose apos a insercao');
  }
  return { texto: novo, jaExistia: false };
}

function acrescentarEnv(textoOriginal, linhasNovas) {
  const original = textoOriginal == null ? '' : String(textoOriginal);
  const existentes = new Set();
  for (const linha of original.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const eq = limpa.indexOf('=');
    if (eq > 0) existentes.add(limpa.slice(0, eq).trim());
  }
  const adicionar = [];
  for (const linha of linhasNovas) {
    const eq = linha.indexOf('=');
    if (eq <= 0) continue;
    const chave = linha.slice(0, eq).trim();
    if (existentes.has(chave)) continue;
    existentes.add(chave);
    adicionar.push(linha);
  }
  if (adicionar.length === 0) return { texto: original, acrescentadas: [] };
  const eol = fimDeLinha(original || '\n');
  const sep = original.length === 0 ? '' : original.endsWith('\n') ? '' : eol;
  const bloco = `${sep}${eol}# studio: variaveis acrescentadas pelo catalogo${eol}${adicionar.join(eol)}${eol}`;
  return { texto: `${original}${bloco}`, acrescentadas: adicionar };
}

module.exports = { inserirServico, acrescentarEnv };
