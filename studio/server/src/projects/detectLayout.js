'use strict';

/**
 * Import de pasta existente.
 * Pastas conhecidas do layout de api/ viram camadas com editor proprio.
 * O resto (certs, plugin, Logs/exeptions, ...) vira camada de texto (monaco),
 * sem inferir entidade, rota ou use case.
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_IGNORE } = require('../context/projectContext');
const { NAMING, FILE_TEMPLATES, emptyServices } = require('./manifest');

const SKIP_DIRS = new Set(['node_modules', '.git', '.studio', 'coverage', 'dist']);

/** Assinaturas na ordem do layout. `path` pode ter placeholder; a pasta real e o base. */
const SIGNATURES = [
  { id: 'domain', path: '@core/domain', editor: 'domain-form', file: '{Entity}.js' },
  { id: 'usecase', path: '@core/usecase/{Entity}', editor: 'blocks', file: '{action}{Entity}UseCase.js' },
  { id: 'repository', path: 'infrastructure/db/services', editor: 'text', file: '{Entity}Repository.js' },
  { id: 'controller', path: 'infrastructure/Controllers', editor: 'text', file: '{Entity}Controller.js' },
  { id: 'routes', path: 'infrastructure/routes', editor: 'text', file: '{entity}.js' },
  { id: 'worker', path: 'infrastructure/queue/workers', editor: 'text', file: '{name}Worker.js' },
  { id: 'migration', path: 'knex/migrations', editor: 'text', file: '{timestamp}_{snake}.js' },
  { id: 'gateway', path: 'infrastructure/gateways', editor: 'text', file: '{Name}/index.js' },
];

function baseOf(layerPath) {
  const segs = String(layerPath || '').split('/');
  const idx = segs.findIndex((s) => s.includes('{'));
  return idx === -1 ? layerPath : segs.slice(0, idx).join('/');
}

function isDir(abs) {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function layerIdFromPath(rel) {
  const id = rel
    .replace(/[@{}]/g, '')
    .split('/')
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || 'pasta';
}

function uniqueId(base, used) {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function hiddenByIgnore(rel) {
  const segs = rel.split('/');
  return DEFAULT_IGNORE.some((entry) => {
    if (entry.includes('/')) return rel === entry || rel.startsWith(`${entry}/`);
    return segs.includes(entry);
  });
}

function readPortHint(root) {
  const file = path.join(root, 'env-example.txt');
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^PORT\s*=\s*(\d+)\s*$/m);
    if (m) return Number(m[1]);
  } catch {
    /* sem env-example */
  }
  return undefined;
}

function detectEntry(root) {
  if (isDir(root) && fs.existsSync(path.join(root, 'index.js'))) return 'index.js';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (typeof pkg.main === 'string' && pkg.main) return pkg.main.replace(/^\.\//, '');
  } catch {
    /* sem package.json */
  }
  return 'index.js';
}

/**
 * Somente leitura. Nao cria studio.project.json.
 * @returns {{ hasManifest: boolean, rootPath: string, layers: object[], unmapped: object[], manifest: object }}
 */
function detectProjectLayout(rootPath) {
  const root = path.resolve(rootPath);
  const manifestPath = path.join(root, 'studio.project.json');
  const hasManifest = fs.existsSync(manifestPath);

  const known = [];
  const knownBases = [];
  for (const sig of SIGNATURES) {
    const base = baseOf(sig.path);
    if (!base || !isDir(path.join(root, base))) continue;
    known.push({
      id: sig.id,
      path: sig.path,
      editor: sig.editor,
      file: sig.file,
      detected: true,
      basePath: base,
    });
    knownBases.push(base);
  }

  const insideKnown = (rel) => knownBases.some((b) => rel === b || rel.startsWith(`${b}/`));
  const ancestorOfKnown = (rel) => knownBases.some((b) => b.startsWith(`${rel}/`));

  const unmappedRels = [];
  function walk(abs, rel) {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (insideKnown(child)) continue;
      if (ancestorOfKnown(child)) {
        walk(path.join(abs, e.name), child);
        continue;
      }
      unmappedRels.push(child);
    }
  }
  walk(root, '');

  // Exemplo explicito do layout irregular de api/: a pasta de excecoes entra
  // como camada propria, mesmo estando sob Logs.
  if (isDir(path.join(root, 'Logs/exeptions')) && !unmappedRels.includes('Logs/exeptions') && !insideKnown('Logs/exeptions')) {
    unmappedRels.push('Logs/exeptions');
  }

  const used = new Set(known.map((l) => l.id));
  const unmapped = unmappedRels.sort().map((rel) => ({
    id: uniqueId(layerIdFromPath(rel), used),
    path: rel,
    editor: 'monaco',
    detected: false,
    unmapped: true,
    hiddenByIgnore: hiddenByIgnore(rel),
  }));

  const layers = {};
  for (const layer of known) {
    layers[layer.id] = { path: layer.path, editor: layer.editor, file: layer.file };
  }
  for (const layer of unmapped) {
    layers[layer.id] = { path: layer.path, editor: 'monaco' };
  }

  const manifest = {
    name: path.basename(root),
    runtime: 'node',
    entry: detectEntry(root),
    port: readPortHint(root),
    archived: false,
    layers,
    naming: { ...NAMING },
    fileTemplates: { ...FILE_TEMPLATES },
    services: emptyServices(),
    blocks: ['core', '.studio/blocks'],
    ignore: [...DEFAULT_IGNORE],
  };

  return {
    dryRun: true,
    wrote: false,
    hasManifest,
    rootPath: root,
    name: manifest.name,
    layers: known,
    unmapped,
    manifest: hasManifest ? null : manifest,
  };
}

module.exports = { detectProjectLayout, SIGNATURES, baseOf };
