'use strict';

/**
 * Esqueleto de consumidor de fila. O codigo gerado fica na camada worker
 * (por padrao infrastructure/queue/workers).
 */

const { parseFile } = require('../services/astService');
const { HttpError } = require('../util/httpError');
const { layerBase, relRequire, exigirIdent } = require('./caminhos');
const { listarJs } = require('./rotas');

const FILA = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function renderConsumer({ nome, fila, requireRabbit }) {
  return `'use strict';

const RabbitMQ = require(${JSON.stringify(requireRabbit)});

class ${nome}Consumer {
    async start() {
        const fila = process.env.QUEUE_NAME || ${JSON.stringify(fila)};
        const rabbit = typeof RabbitMQ.getInstance === 'function' ? RabbitMQ.getInstance() : RabbitMQ;
        const channel = await rabbit.getConfirmChannel();
        await channel.assertQueue(fila, { durable: true });
        await channel.consume(fila, async (msg) => {
            if (!msg) return;
            try {
                JSON.parse(msg.content.toString());
                channel.ack(msg);
            } catch (err) {
                channel.nack(msg, false, false);
            }
        });
    }
}

module.exports = new ${nome}Consumer();
`;
}

async function listarWorkers(ctx) {
  return listarJs(ctx, 'worker');
}

async function criarWorker(ctx, files, { nome, fila }) {
  const nomeOk = exigirIdent(nome, 'Nome do consumidor');
  if (typeof fila !== 'string' || !FILA.test(fila)) {
    throw HttpError.badRequest('FILA_INVALIDA', 'Nome de fila invalido');
  }
  const base = layerBase(ctx, 'worker');
  const rel = `${base}/${nomeOk}/index.js`;
  const gateway = layerBase(ctx, 'gateway');
  const requireRabbit = relRequire(rel, `${gateway}/rabbitmq`);
  const content = renderConsumer({ nome: nomeOk, fila, requireRabbit });
  parseFile(content);
  const gravado = await files.writeFile(ctx, rel, content, null);
  return { ...gravado, fila, nome: nomeOk };
}

module.exports = { listarWorkers, criarWorker, renderConsumer };
