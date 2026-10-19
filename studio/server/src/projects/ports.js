'use strict';

/**
 * Sugere portas livres. Reserva a porta do Studio (7900) e a porta do api/
 * quando PORT=9366 (ou outro valor) aparece no env do api.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { repoRoot } = require('./paths');

function readPortLine(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^PORT\s*=\s*(\d+)\s*$/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function reservedSet(extra = []) {
  const set = new Set([7900]);
  const studio = Number(process.env.STUDIO_SERVER_PORT || 7900);
  if (studio) set.add(studio);
  const apiDir = path.join(repoRoot(), 'api');
  for (const file of [path.join(apiDir, 'env-example.txt'), path.join(apiDir, '.env')]) {
    const port = readPortLine(file);
    if (port) set.add(port);
  }
  for (const p of extra) {
    const n = Number(p);
    if (n) set.add(n);
  }
  return set;
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function firstFree(start, reserved, span = 400) {
  for (let p = start; p < start + span; p++) {
    if (p < 1 || p > 65535) continue;
    if (reserved.has(p)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await canListen(p)) return p;
  }
  return null;
}

async function suggestPorts({ taken = [] } = {}) {
  const reserved = reservedSet(taken);
  const used = new Set(reserved);

  async function take(start) {
    const port = await firstFree(start, used);
    if (port) used.add(port);
    return port;
  }

  const port = await take(3210);
  const mysql = await take(3306);
  const redis = await take(6379);
  const rabbitmq = await take(5672);
  const rabbitmqManagement = await take(15672);
  const mailpitSmtp = await take(1025);
  const mailpitUi = await take(8025);

  return {
    port,
    reserved: [...reserved].sort((a, b) => a - b),
    services: {
      mysql: { port: mysql },
      redis: { port: redis },
      rabbitmq: { port: rabbitmq, managementPort: rabbitmqManagement },
      mailpit: { smtpPort: mailpitSmtp, uiPort: mailpitUi },
    },
  };
}

async function isFree(port, taken = []) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return false;
  if (reservedSet(taken).has(n)) return false;
  return canListen(n);
}

module.exports = { suggestPorts, reservedSet, isFree, canListen };
