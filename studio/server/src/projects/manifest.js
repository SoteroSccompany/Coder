'use strict';

/**
 * Forma do studio.project.json. Campos desconhecidos sao preservados pelo
 * ProjectContext (o spread do raw acontece antes de layers/ignore normalizados).
 */

const fs = require('fs');
const path = require('path');
const { MANIFEST_FILE, DEFAULT_IGNORE } = require('../context/projectContext');
const { writeAtomic } = require('./paths');

const STANDARD_LAYERS = Object.freeze({
  domain: { path: '@core/domain', editor: 'domain-form', file: '{Entity}.js' },
  usecase: { path: '@core/usecase/{Entity}', editor: 'blocks', file: '{action}{Entity}UseCase.js' },
  repository: { path: 'infrastructure/db/services', editor: 'text', file: '{Entity}Repository.js' },
  controller: { path: 'infrastructure/Controllers', editor: 'text', file: '{Entity}Controller.js' },
  routes: { path: 'infrastructure/routes', editor: 'text', file: '{entity}.js' },
  worker: { path: 'infrastructure/queue/workers', editor: 'text', file: '{name}Worker.js' },
  migration: { path: 'knex/migrations', editor: 'text', file: '{timestamp}_{snake}.js' },
  gateway: { path: 'infrastructure/gateways', editor: 'text', file: '{Name}/index.js' },
});

const NAMING = Object.freeze({
  entity: '{Entity}',
  table: 'tab_{snake}',
  controller: '{Entity}Controller.js',
  useCase: '{action}{Entity}UseCase.js',
  repository: '{Entity}Repository.js',
  domain: '{Entity}.js',
});

const FILE_TEMPLATES = Object.freeze({
  domain: [
    'class {{Entity}} {',
    '  constructor(dados = {}) {',
    '    Object.assign(this, dados);',
    '  }',
    '}',
    'module.exports = {{Entity}};',
    '',
  ].join('\n'),
  usecase: [
    'class {{action}}{{Entity}}UseCase {',
    '  async executar(input) {',
    '    if (!input) return { status: false, msg: "Dados obrigatorios" };',
    '    return { status: true, msg: "ok" };',
    '  }',
    '}',
    'module.exports = {{action}}{{Entity}}UseCase;',
    '',
  ].join('\n'),
  repository: [
    'class {{Entity}}Repository {',
    '  async listar() {',
    '    return [];',
    '  }',
    '}',
    'module.exports = new {{Entity}}Repository();',
    '',
  ].join('\n'),
  controller: [
    'class {{Entity}}Controller {',
    '  async index(req, res) {',
    '    res.json({ status: true });',
    '  }',
    '}',
    'module.exports = new {{Entity}}Controller();',
    '',
  ].join('\n'),
});

function emptyServices() {
  return {
    mysql: { enabled: false, port: 3306, host: 'mysql' },
    redis: { enabled: false, port: 6379, host: 'redis' },
    rabbitmq: { enabled: false, port: 5672, managementPort: 15672, host: 'rabbitmq' },
    mailpit: { enabled: false, smtpPort: 1025, uiPort: 8025, host: 'mailpit' },
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Remove id/basePath que o ProjectContext acrescenta ao normalizar. */
function cleanLayer(layer) {
  if (!layer || typeof layer !== 'object') return layer;
  const { id, basePath, ...rest } = layer;
  return rest;
}

function cleanLayers(layers) {
  const out = {};
  for (const [id, layer] of Object.entries(layers || {})) out[id] = cleanLayer(layer);
  return out;
}

function readRaw(rootPath) {
  const file = path.join(rootPath, MANIFEST_FILE);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeManifest(rootPath, manifest) {
  writeAtomic(path.join(rootPath, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Manifesto gravado a partir do template + respostas do wizard.
 * Senhas ficam no .env / compose, nao aqui.
 */
function buildManifest({ template, answers }) {
  const layers = template.layers ? clone(template.layers) : clone(STANDARD_LAYERS);
  const blocks = Array.isArray(template.blocks) && template.blocks.length ? [...template.blocks] : ['core', '.studio/blocks'];
  if (!blocks.includes('.studio/blocks')) blocks.push('.studio/blocks');
  if (!blocks.includes('core')) blocks.unshift('core');

  return {
    name: answers.name,
    runtime: 'node',
    entry: template.entry || 'index.js',
    port: answers.port,
    template: template.id,
    createdAt: new Date().toISOString(),
    archived: false,
    layers,
    naming: clone(NAMING),
    fileTemplates: clone(FILE_TEMPLATES),
    services: answers.services,
    blocks,
    ignore: [...DEFAULT_IGNORE],
  };
}

module.exports = {
  MANIFEST_FILE,
  STANDARD_LAYERS,
  NAMING,
  FILE_TEMPLATES,
  emptyServices,
  clone,
  cleanLayer,
  cleanLayers,
  readRaw,
  writeManifest,
  buildManifest,
};
