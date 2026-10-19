'use strict';

/**
 * Biblioteca de blocos: globais em `studio/blocks/<categoria>/*.block.json`
 * mais os do projeto em `<projeto>/.studio/blocks/` (o de mesmo `id` vence).
 * O manifesto `blocks` pode filtrar ids ou apontar pastas extras.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_GLOBAL_DIR = path.resolve(__dirname, '../../../blocks');

const SKIP_DIRS = new Set(['node_modules', '.git']);

function walkBlockFiles(dir, out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkBlockFiles(abs, out);
    } else if (e.isFile() && e.name.endsWith('.block.json')) {
      out.push(abs);
    }
  }
  return out;
}

function readBlock(abs) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.warn(`[blocks] JSON invalido em ${abs}: ${err.message}`);
    return null;
  }
  if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) {
    console.warn(`[blocks] bloco sem id: ${abs}`);
    return null;
  }
  return raw;
}

function loadDir(dir, origin) {
  const blocks = [];
  for (const abs of walkBlockFiles(dir)) {
    const block = readBlock(abs);
    if (!block) continue;
    blocks.push({ ...block, origin, arquivo: abs });
  }
  return blocks;
}

/** Ids (`categoria.nome`) viram filtro; caminhos viram pastas extras. `core` = biblioteca global. */
function interpretManifest(spec) {
  const ids = [];
  const extra = [];
  if (!Array.isArray(spec)) return { ids, extra };
  for (const item of spec) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s || s === 'core' || s === 'global') continue;
    if (s.includes('/') || s.startsWith('.')) extra.push(s);
    else if (s.includes('.')) ids.push(s);
  }
  return { ids, extra };
}

/**
 * @param {import('../context/projectContext').ProjectContext | null} ctx
 * @param {{ globalDir?: string }} [opts]
 */
function loadLibrary(ctx, opts = {}) {
  const globalDir = opts.globalDir || DEFAULT_GLOBAL_DIR;
  const byId = new Map();
  for (const b of loadDir(globalDir, 'global')) byId.set(b.id, b);

  const manifestBlocks = ctx && ctx.manifest ? ctx.manifest.blocks : [];
  const { ids, extra } = interpretManifest(manifestBlocks);

  if (ctx) {
    const extras = [path.join(ctx.rootPath, '.studio', 'blocks')];
    for (const rel of extra) {
      try {
        extras.push(ctx.resolvePath(rel).abs);
      } catch {
        /* caminho fora do projeto: ignora */
      }
    }
    const seen = new Set();
    for (const dir of extras) {
      const key = path.resolve(dir);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const b of loadDir(dir, 'project')) byId.set(b.id, b);
    }
  }

  let list = [...byId.values()];
  if (ids.length) {
    const allow = new Set(ids);
    list = list.filter((b) => allow.has(b.id) || String(b.id).startsWith('livre.') || b.origin === 'project');
  }
  list.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id));
  return list;
}

function asMap(list) {
  return new Map(list.map((b) => [b.id, b]));
}

/** Tira caminhos absolutos antes de devolver a biblioteca ao cliente. */
function toPublic(block) {
  const { arquivo, ...rest } = block;
  return { ...rest, arquivo: arquivo ? path.basename(arquivo) : undefined };
}

module.exports = {
  DEFAULT_GLOBAL_DIR,
  loadLibrary,
  loadDir,
  asMap,
  toPublic,
  walkBlockFiles,
};
