'use strict';

/**
 * Cria um projeto real em <workspace>/projects/<slug> a partir de um template.
 */

const fs = require('fs');
const path = require('path');
const { HttpError } = require('../util/httpError');
const { projectsDir, slugify, uniqueDest } = require('./paths');
const { buildManifest, writeManifest, emptyServices } = require('./manifest');
const { loadTemplate, copyTree } = require('./templates');
const { finalizeCompose } = require('./compose');
const { isFree, suggestPorts } = require('./ports');

const SERVICE_IDS = ['mysql', 'redis', 'rabbitmq', 'mailpit'];

function dbNameFromSlug(slug) {
  const n = slug.replace(/-/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 48);
  return n || 'app';
}

function asEnabledMap(input, suggested) {
  const enabled = Object.fromEntries(SERVICE_IDS.map((id) => [id, false]));
  if (input == null) {
    for (const id of suggested || []) enabled[id] = true;
    return enabled;
  }
  if (Array.isArray(input)) {
    for (const id of input) if (SERVICE_IDS.includes(id)) enabled[id] = true;
    return enabled;
  }
  if (typeof input === 'object') {
    for (const id of SERVICE_IDS) {
      const v = input[id];
      if (v === true) enabled[id] = true;
      else if (v && typeof v === 'object') enabled[id] = v.enabled !== false;
    }
  }
  return enabled;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : fallback;
}

async function normalizeAnswers(body, template, takenPorts) {
  const name = String(body.name || '').trim();
  if (!name) throw HttpError.badRequest('NAME_REQUIRED', 'Informe o nome do projeto');
  const slug = slugify(body.slug || name);
  const enabled = asEnabledMap(body.services, template.suggestedServices);

  const hinted = await suggestPorts({ taken: takenPorts });
  let port = body.port == null || body.port === '' ? hinted.port : Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw HttpError.badRequest('PORT_INVALID', 'Porta invalida');
  }
  if (!(await isFree(port, takenPorts))) {
    throw HttpError.badRequest('PORT_RESERVED', `Porta ${port} esta reservada ou em uso`, { port });
  }

  const ports = body.servicePorts || {};
  const database = String(body.database || dbNameFromSlug(slug));
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw HttpError.badRequest('DATABASE_INVALID', 'Nome do banco: letras, numeros e underscore');
  }

  const dbUser = String(body.dbUser || 'app');
  const dbPassword = String(body.dbPassword || 'devapp');
  const dbRootPassword = String(body.dbRootPassword || 'devroot');
  const dbPort = num(ports.mysql ?? body.dbPort, hinted.services.mysql.port || 3306);
  const redisPort = num(ports.redis ?? body.redisPort, hinted.services.redis.port || 6379);
  const rabbitPort = num(ports.rabbitmq ?? body.rabbitPort, hinted.services.rabbitmq.port || 5672);
  const rabbitMgmtPort = num(ports.rabbitmqManagement ?? body.rabbitMgmtPort, hinted.services.rabbitmq.managementPort || 15672);
  const mailpitSmtp = num(ports.mailpitSmtp ?? body.mailpitSmtp, hinted.services.mailpit.smtpPort || 1025);
  const mailpitUi = num(ports.mailpitUi ?? body.mailpitUi, hinted.services.mailpit.uiPort || 8025);

  const services = emptyServices();
  services.mysql = { enabled: enabled.mysql, port: dbPort, database, user: dbUser, host: 'mysql' };
  services.redis = { enabled: enabled.redis, port: redisPort, host: 'redis' };
  services.rabbitmq = {
    enabled: enabled.rabbitmq,
    port: rabbitPort,
    managementPort: rabbitMgmtPort,
    host: 'rabbitmq',
    user: 'app',
  };
  services.mailpit = { enabled: enabled.mailpit, smtpPort: mailpitSmtp, uiPort: mailpitUi, host: 'mailpit' };

  const vars = {
    name,
    slug,
    port,
    database,
    dbUser,
    dbPassword,
    dbRootPassword,
    dbPort,
    redisPort,
    rabbitPort,
    rabbitMgmtPort,
    mailpitSmtp,
    mailpitUi,
    rabbitUser: 'app',
    rabbitPassword: dbPassword,
    queueName: body.queueName || 'fila',
  };

  return { name, slug, port, database, enabled, services, vars, dbPassword, dbRootPassword, dbUser };
}

function ensureBlocksDir(root) {
  const dir = path.join(root, '.studio', 'blocks');
  fs.mkdirSync(dir, { recursive: true });
  const keep = path.join(dir, '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
}

async function createFromTemplate({ body, takenPorts = [] }) {
  const templateId = String(body.template || '').trim();
  if (!templateId) throw HttpError.badRequest('TEMPLATE_REQUIRED', 'Escolha um template');
  const template = loadTemplate(templateId, body.templateSource || body.source);
  const answers = await normalizeAnswers(body, template, takenPorts);

  fs.mkdirSync(projectsDir(), { recursive: true });
  const dest = uniqueDest(projectsDir(), answers.slug);
  const finalSlug = path.basename(dest);
  answers.slug = finalSlug;
  answers.vars.slug = finalSlug;
  fs.mkdirSync(dest, { recursive: true });

  try {
    copyTree(template.dir, dest, {
      skipNames: ['template.json'],
      renderVars: answers.vars,
      enabled: answers.enabled,
    });
    const manifest = buildManifest({ template, answers: { ...answers, services: answers.services } });
    writeManifest(dest, manifest);
    ensureBlocksDir(dest);

    const composePath = path.join(dest, 'docker-compose.yaml');
    if (!fs.existsSync(composePath)) {
      throw new HttpError(500, 'COMPOSE_MISSING', `O template ${template.id} nao tem docker-compose.yaml`);
    }
    const validation = finalizeCompose(composePath, {
      slug: path.basename(dest),
      port: answers.port,
      database: answers.database,
      dbUser: answers.dbUser,
      dbPassword: answers.dbPassword,
      dbRootPassword: answers.dbRootPassword,
      dbPort: answers.services.mysql.port,
      redisPort: answers.services.redis.port,
      rabbitPort: answers.services.rabbitmq.port,
      rabbitMgmtPort: answers.services.rabbitmq.managementPort,
      rabbitUser: 'app',
      rabbitPassword: answers.vars.rabbitPassword,
      mailpitSmtp: answers.services.mailpit.smtpPort,
      mailpitUi: answers.services.mailpit.uiPort,
      enabled: answers.enabled,
    });
    return { dest, manifest, template, validation, slug: path.basename(dest) };
  } catch (err) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw err;
  }
}

module.exports = { createFromTemplate, ensureBlocksDir, normalizeAnswers, SERVICE_IDS };
