'use strict';

const fs = require('fs');
const { HttpError } = require('../util/httpError');
const { layerBase } = require('../layers/caminhos');
const { obterServico, renderGateway } = require('./catalogo');
const { inserirServico, acrescentarEnv } = require('./compose');

const COMPOSE = 'docker-compose.yaml';
const ENV_EXEMPLO = 'env-example.txt';

async function lerOuVazio(ctx, files, rel) {
  try {
    return await files.readFile(ctx, rel);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

function gatewayRel(ctx, id) {
  let base = 'infrastructure/gateways';
  try {
    base = layerBase(ctx, 'gateway');
  } catch {
    /* manifesto sem a camada: cai no caminho padrao do catalogo */
  }
  return `${base}/${id}/index.js`;
}

async function adicionarServico(ctx, files, id) {
  const item = obterServico(id);
  if (!item) throw HttpError.badRequest('SERVICO_DESCONHECIDO', `Servico fora do catalogo: ${id}`);
  if (id === '.env' || COMPOSE.includes('.env')) {
    throw HttpError.forbidden('PATH_IGNORED', 'O Studio nao le nem grava .env');
  }

  const composeAtual = await lerOuVazio(ctx, files, COMPOSE);
  const inserido = inserirServico(composeAtual ? composeAtual.content : '', id, item.yaml);
  let composeGravado = null;
  if (!inserido.jaExistia) {
    composeGravado = await files.writeFile(ctx, COMPOSE, inserido.texto, composeAtual ? composeAtual.hash : null);
  }

  const envAtual = await lerOuVazio(ctx, files, ENV_EXEMPLO);
  const envNovo = acrescentarEnv(envAtual ? envAtual.content : '', item.env);
  let envGravado = null;
  if (envNovo.acrescentadas.length) {
    envGravado = await files.writeFile(ctx, ENV_EXEMPLO, envNovo.texto, envAtual ? envAtual.hash : null);
  }

  const gw = gatewayRel(ctx, id);
  let gatewayCriado = false;
  let gateway = null;
  const jaGateway = fs.existsSync(ctx.resolvePath(gw).abs);
  if (!jaGateway) {
    gateway = await files.writeFile(ctx, gw, renderGateway(item), null);
    gatewayCriado = true;
  }

  return {
    id,
    titulo: item.titulo,
    jaExistia: inserido.jaExistia,
    compose: COMPOSE,
    composeHash: composeGravado ? composeGravado.hash : composeAtual && composeAtual.hash,
    envExample: ENV_EXEMPLO,
    envAcrescentadas: envNovo.acrescentadas,
    envHash: envGravado ? envGravado.hash : envAtual && envAtual.hash,
    gateway: gw,
    gatewayCriado,
    gatewayHash: gateway && gateway.hash,
    blocos: item.blocos,
  };
}

module.exports = { adicionarServico, COMPOSE, ENV_EXEMPLO, gatewayRel };
