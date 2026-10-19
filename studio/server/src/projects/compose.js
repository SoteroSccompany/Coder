'use strict';

/**
 * Normaliza o docker-compose.yaml do projeto (rede propria, nunca external)
 * e valida. Usa `docker compose config` quando o CLI existe; senao, parse YAML.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const { HttpError } = require('../util/httpError');

function yamlLib() {
  return require('yaml');
}

function dockerAvailable() {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function infraService(id, spec) {
  const net = [spec.slug];
  if (id === 'mysql') {
    return {
      image: 'mysql:8.4',
      container_name: `${spec.slug}-mysql`,
      restart: 'unless-stopped',
      environment: {
        MYSQL_ROOT_PASSWORD: spec.dbRootPassword,
        MYSQL_DATABASE: spec.database,
        MYSQL_USER: spec.dbUser,
        MYSQL_PASSWORD: spec.dbPassword,
      },
      ports: [`${spec.dbPort}:3306`],
      volumes: ['mysql-data:/var/lib/mysql'],
      networks: net,
    };
  }
  if (id === 'redis') {
    return {
      image: 'redis:7.2-alpine',
      container_name: `${spec.slug}-redis`,
      restart: 'unless-stopped',
      ports: [`${spec.redisPort}:6379`],
      volumes: ['redis-data:/data'],
      networks: net,
    };
  }
  if (id === 'rabbitmq') {
    return {
      image: 'rabbitmq:3-management',
      container_name: `${spec.slug}-rabbitmq`,
      restart: 'unless-stopped',
      environment: {
        RABBITMQ_DEFAULT_USER: spec.rabbitUser,
        RABBITMQ_DEFAULT_PASS: spec.rabbitPassword,
      },
      ports: [`${spec.rabbitPort}:5672`, `${spec.rabbitMgmtPort}:15672`],
      volumes: ['rabbit-data:/var/lib/rabbitmq'],
      networks: net,
    };
  }
  if (id === 'mailpit') {
    return {
      image: 'axllent/mailpit:latest',
      container_name: `${spec.slug}-mailpit`,
      restart: 'unless-stopped',
      ports: [`${spec.mailpitSmtp}:1025`, `${spec.mailpitUi}:8025`],
      networks: net,
    };
  }
  return null;
}

function assertComposeDoc(doc) {
  if (!doc || typeof doc !== 'object' || !doc.services || typeof doc.services !== 'object') {
    throw new HttpError(500, 'COMPOSE_INVALID', 'docker-compose.yaml sem services');
  }
  if (!doc.networks || typeof doc.networks !== 'object' || !Object.keys(doc.networks).length) {
    throw new HttpError(500, 'COMPOSE_INVALID', 'docker-compose.yaml precisa de uma rede propria');
  }
  for (const [name, net] of Object.entries(doc.networks)) {
    if (net && net.external) {
      throw new HttpError(500, 'COMPOSE_EXTERNAL_NETWORK', `A rede "${name}" nao pode ser external`);
    }
  }
}

function validateComposeFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  let doc;
  try {
    doc = yamlLib().parse(text);
  } catch (err) {
    throw new HttpError(500, 'COMPOSE_INVALID', `YAML invalido: ${err.message}`);
  }
  assertComposeDoc(doc);
  if (!dockerAvailable()) return { engine: 'yaml', doc };

  try {
    execFileSync('docker', ['compose', '-f', filePath, 'config'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { engine: 'docker', doc };
  } catch (err) {
    const msg = `${err.stderr || ''} ${err.stdout || ''} ${err.message || ''}`;
    if (/cannot connect|docker daemon|permission denied|ENOENT|broken pipe/i.test(msg)) {
      return { engine: 'yaml', doc, dockerWarning: msg.slice(0, 240) };
    }
    throw new HttpError(500, 'COMPOSE_INVALID', `docker compose config falhou: ${msg.slice(0, 500)}`);
  }
}

/**
 * Reescreve o compose copiado do template: servicos escolhidos, portas e rede propria.
 */
function finalizeCompose(filePath, spec) {
  const YAML = yamlLib();
  let doc;
  try {
    doc = YAML.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new HttpError(500, 'COMPOSE_INVALID', `docker-compose do template invalido: ${err.message}`);
  }
  if (!doc || typeof doc !== 'object') doc = {};
  doc.services = doc.services && typeof doc.services === 'object' ? doc.services : {};
  doc.name = spec.slug;

  const infraIds = ['mysql', 'redis', 'rabbitmq', 'mailpit'];
  for (const id of infraIds) delete doc.services[id];
  const enabled = infraIds.filter((id) => spec.enabled[id]);
  for (const id of enabled) doc.services[id] = infraService(id, spec);

  const volumes = {};
  if (spec.enabled.mysql) volumes['mysql-data'] = {};
  if (spec.enabled.redis) volumes['redis-data'] = {};
  if (spec.enabled.rabbitmq) volumes['rabbit-data'] = {};
  if (Object.keys(volumes).length) doc.volumes = volumes;
  else delete doc.volumes;

  doc.networks = { [spec.slug]: { driver: 'bridge' } };

  for (const [key, svc] of Object.entries(doc.services)) {
    if (!svc || typeof svc !== 'object') continue;
    svc.networks = [spec.slug];
    if (infraIds.includes(key)) continue;
    const env = svc.environment && !Array.isArray(svc.environment) ? { ...svc.environment } : {};
    env.PORT = String(spec.port);
    env.TZ = env.TZ || 'America/Sao_Paulo';
    svc.environment = env;
    svc.ports = [`${spec.port}:${spec.port}`];
    if (enabled.length) svc.depends_on = enabled;
    else delete svc.depends_on;
  }

  assertComposeDoc(doc);
  const text = YAML.stringify(doc);
  fs.writeFileSync(filePath, text.endsWith('\n') ? text : `${text}\n`);
  return validateComposeFile(filePath);
}

module.exports = { finalizeCompose, validateComposeFile, assertComposeDoc, dockerAvailable };
