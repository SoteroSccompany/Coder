'use strict';

/**
 * Move/renomeia a pasta de uma camada e reescreve require()/import relativos
 * via AST (recast). A previa nao grava. O apply grava em temp, troca e
 * desfaz tudo se algum passo falhar.
 */

const fs = require('fs');
const path = require('path');
const traverse = require('@babel/traverse').default;
const { HttpError } = require('../util/httpError');
const { writeAtomic } = require('./paths');
const { readRaw, writeManifest, cleanLayers, STANDARD_LAYERS, NAMING, FILE_TEMPLATES, emptyServices } = require('./manifest');

function normalizeRel(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function splitBase(layerPath) {
  const norm = normalizeRel(layerPath);
  const segs = norm.split('/');
  const idx = segs.findIndex((s) => s.includes('{'));
  if (idx === -1) return { base: norm, suffix: '' };
  return { base: segs.slice(0, idx).join('/'), suffix: segs.slice(idx).join('/') };
}

function assertRelativeLayerPath(layerPath) {
  const norm = normalizeRel(layerPath);
  if (!norm || norm.includes('\0') || norm.split('/').includes('..') || path.posix.isAbsolute(norm)) {
    throw HttpError.badRequest('PATH_INVALID', 'Caminho de camada invalido');
  }
  return norm;
}

function mapRel(rel, oldBase, newBase) {
  if (!oldBase) return rel;
  if (rel === oldBase) return newBase;
  if (rel.startsWith(`${oldBase}/`)) return newBase + rel.slice(oldBase.length);
  return rel;
}

function resolveSpecifier(fromFile, spec) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return null;
  const dir = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(dir, spec));
  if (!joined || joined === '.' || joined.startsWith('..') || joined.startsWith('/')) return null;
  return joined;
}

function toSpecifier(fromFile, target) {
  const fromDir = path.posix.dirname(fromFile);
  let rel = path.posix.relative(fromDir, target);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function setSpecifier(node, next) {
  if (!node || node.type !== 'StringLiteral' || node.value === next) return false;
  const raw = node.extra && node.extra.raw;
  const quote = raw && raw.startsWith('"') ? '"' : "'";
  const escaped = next.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`);
  node.value = next;
  if (node.extra) {
    node.extra.raw = quote + escaped + quote;
    node.extra.rawValue = next;
  }
  return true;
}

function walkJs(ctx) {
  const out = [];
  function walk(abs, rel) {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (ctx.isIgnored(child)) continue;
      const full = path.join(abs, e.name);
      if (e.isDirectory()) walk(full, child);
      else if (e.isFile() && e.name.endsWith('.js')) out.push(child);
    }
  }
  walk(ctx.rootPath, '');
  return out;
}

function rewriteSource(astApi, source, fromFile, oldBase, newBase) {
  const ast = astApi.parseFile(source);
  const specifiers = [];
  const newFrom = mapRel(fromFile, oldBase, newBase);

  function consider(node) {
    const previous = node.value;
    const target = resolveSpecifier(fromFile, previous);
    if (!target) return;
    const newTarget = mapRel(target, oldBase, newBase);
    const next = toSpecifier(newFrom, newTarget);
    if (next !== previous && setSpecifier(node, next)) {
      specifiers.push({ from: previous, to: next });
    }
  }

  traverse(ast, {
    noScope: true,
    CallExpression(p) {
      const n = p.node;
      const callee = n.callee;
      const isRequire =
        (callee.type === 'Identifier' && callee.name === 'require') ||
        (callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'require' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'resolve');
      if (!isRequire) return;
      const arg = n.arguments[0];
      if (arg && arg.type === 'StringLiteral') consider(arg);
    },
    ImportDeclaration(p) {
      if (p.node.source && p.node.source.type === 'StringLiteral') consider(p.node.source);
    },
    ExportAllDeclaration(p) {
      if (p.node.source && p.node.source.type === 'StringLiteral') consider(p.node.source);
    },
    ExportNamedDeclaration(p) {
      if (p.node.source && p.node.source.type === 'StringLiteral') consider(p.node.source);
    },
  });

  // setSpecifier compara antes de alterar; o array guarda o valor ja novo.
  // Recalcula from/to a partir do que mudou: se specifiers foi preenchido, o print difere.
  let after = specifiers.length ? astApi.print(ast) : source;
  if (specifiers.length && after === source) {
    for (const spec of specifiers) {
      after = after.split(`'${spec.from}'`).join(`'${spec.to}'`).split(`"${spec.from}"`).join(`"${spec.to}"`);
    }
  }
  return { after, specifiers, changed: after !== source };
}

function diffLines(filePath, before, after) {
  if (before === after) return '';
  const b = before.split('\n');
  const a = after.split('\n');
  const out = [`--- ${filePath}`, `+++ ${filePath}`];
  const n = Math.max(b.length, a.length);
  for (let i = 0; i < n; i++) {
    if (b[i] === a[i]) continue;
    if (b[i] !== undefined) out.push(`-${b[i]}`);
    if (a[i] !== undefined) out.push(`+${a[i]}`);
  }
  return out.join('\n');
}

function currentLayer(ctx, layerId) {
  const layer = ctx.layers.find((l) => l.id === layerId);
  if (!layer) throw HttpError.notFound('LAYER_NOT_FOUND', `Camada nao encontrada: ${layerId}`);
  return layer;
}

function storedManifest(ctx) {
  const raw = readRaw(ctx.rootPath);
  if (raw) return raw;
  return {
    name: ctx.manifest.name,
    runtime: ctx.manifest.runtime || 'node',
    entry: ctx.manifest.entry || 'index.js',
    port: ctx.manifest.port,
    archived: !!ctx.manifest.archived,
    layers: cleanLayers(ctx.manifest.layers),
    naming: ctx.manifest.naming || { ...NAMING },
    fileTemplates: ctx.manifest.fileTemplates || { ...FILE_TEMPLATES },
    services: ctx.manifest.services || emptyServices(),
    blocks: ctx.manifest.blocks && ctx.manifest.blocks.length ? ctx.manifest.blocks : ['core', '.studio/blocks'],
    ignore: ctx.ignore,
  };
}

function planLayerRename({ ctx, ast, layerId, nextPath }) {
  if (!ast || typeof ast.parseFile !== 'function' || typeof ast.print !== 'function') {
    throw HttpError.badRequest('AST_REQUIRED', 'Servico de AST indisponivel');
  }
  const layer = currentLayer(ctx, layerId);
  const destPath = assertRelativeLayerPath(nextPath);
  const old = splitBase(layer.path);
  const next = splitBase(destPath);
  if (!next.base) throw HttpError.badRequest('PATH_INVALID', 'Informe a pasta da camada');
  const sameBase = old.base === next.base;
  if (sameBase && normalizeRel(layer.path) === destPath) {
    throw HttpError.badRequest('PATH_UNCHANGED', 'A camada ja usa esse caminho');
  }
  if (!sameBase && old.base && next.base && (next.base.startsWith(`${old.base}/`) || old.base.startsWith(`${next.base}/`))) {
    throw HttpError.badRequest('PATH_OVERLAP', 'A pasta nova nao pode ficar dentro da pasta atual');
  }
  for (const other of ctx.layers) {
    if (other.id === layerId || !other.basePath) continue;
    if (next.base === other.basePath || next.base.startsWith(`${other.basePath}/`) || other.basePath.startsWith(`${next.base}/`)) {
      throw HttpError.badRequest('PATH_OVERLAP', `A pasta coincide com a camada ${other.id}`);
    }
  }

  const srcAbs = old.base ? path.join(ctx.rootPath, old.base) : null;
  const destAbs = path.join(ctx.rootPath, next.base);
  const srcExists = !!(srcAbs && fs.existsSync(srcAbs) && fs.statSync(srcAbs).isDirectory());
  if (fs.existsSync(destAbs)) {
    throw HttpError.conflict('PATH_EXISTS', `Ja existe: ${next.base}`);
  }

  const changes = [];
  const errors = [];
  if (srcExists && old.base !== next.base) {
    for (const rel of walkJs(ctx)) {
      const inside = rel === old.base || rel.startsWith(`${old.base}/`);
      const abs = path.join(ctx.rootPath, rel);
      let source;
      try {
        const buf = fs.readFileSync(abs);
        if (buf.includes(0) || buf.length > 1024 * 1024) continue;
        source = buf.toString('utf8');
      } catch (err) {
        errors.push({ path: rel, message: err.message });
        continue;
      }
      const maybe = source.includes('require(') || source.includes('import') || source.includes(' from ');
      if (!maybe) continue;
      if (!inside && !maybe) continue;
      try {
        const rewritten = rewriteSource(ast, source, rel, old.base, next.base);
        if (!rewritten.changed) continue;
        changes.push({
          path: rel,
          specifiers: rewritten.specifiers,
          diff: diffLines(rel, source, rewritten.after),
          after: rewritten.after,
        });
      } catch (err) {
        if (inside || source.includes(old.base)) errors.push({ path: rel, message: err.message });
      }
    }
  }

  const raw = storedManifest(ctx);
  const layers = cleanLayers(raw.layers && Object.keys(raw.layers).length ? raw.layers : { ...STANDARD_LAYERS });
  const prev = layers[layerId] || { path: layer.path, editor: layer.editor || 'text' };
  if (prev.file == null && layer.file) prev.file = layer.file;
  layers[layerId] = { ...prev, path: destPath };
  const nextManifest = { ...raw, layers };

  return {
    dryRun: true,
    layerId,
    from: layer.path,
    to: destPath,
    directoryMove: srcExists && old.base !== next.base ? { from: old.base, to: next.base } : null,
    changes: changes.map(({ path: p, specifiers, diff }) => ({ path: p, specifiers, diff })),
    errors,
    _pending: changes,
    _manifest: nextManifest,
    _srcAbs: srcExists ? srcAbs : null,
    _destAbs: destAbs,
  };
}

function rollback({ backups, moved, srcAbs, destAbs, manifestPath, manifestBackup, ctx }) {
  if (moved && srcAbs && destAbs && fs.existsSync(destAbs)) {
    try {
      fs.renameSync(destAbs, srcAbs);
    } catch {
      /* tenta restaurar o conteudo mesmo assim */
    }
  }
  for (const [abs, buf] of backups) {
    try {
      fs.writeFileSync(abs, buf);
    } catch {
      /* segue restaurando o resto */
    }
  }
  if (manifestBackup != null) {
    try {
      fs.writeFileSync(manifestPath, manifestBackup);
    } catch {
      /* manifesto pode nao ter sido criado */
    }
  }
  try {
    ctx.reload();
  } catch {
    /* manifesto pode estar inconsistente; o throw original segue */
  }
}

function applyLayerRename({ ctx, ast, layerId, nextPath }) {
  const plan = planLayerRename({ ctx, ast, layerId, nextPath });
  if (plan.errors.length) {
    throw new HttpError(422, 'LAYER_PARSE_ERROR', 'Ha arquivos JS que nao puderam ser analisados', {
      errors: plan.errors,
    });
  }

  const backups = new Map();
  const manifestPath = ctx.manifestPath;
  let manifestBackup = null;
  let moved = false;
  try {
    for (const ch of plan._pending) {
      const abs = path.join(ctx.rootPath, ch.path);
      backups.set(abs, fs.readFileSync(abs));
      writeAtomic(abs, ch.after);
    }
    if (plan.directoryMove && plan._srcAbs) {
      fs.mkdirSync(path.dirname(plan._destAbs), { recursive: true });
      fs.renameSync(plan._srcAbs, plan._destAbs);
      moved = true;
    }
    if (fs.existsSync(manifestPath)) manifestBackup = fs.readFileSync(manifestPath);
    writeManifest(ctx.rootPath, plan._manifest);
    ctx.reload();
  } catch (err) {
    rollback({
      backups,
      moved,
      srcAbs: plan._srcAbs,
      destAbs: plan._destAbs,
      manifestPath,
      manifestBackup,
      ctx,
    });
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, 'LAYER_MOVE_FAILED', `Falha ao mover a camada; alteracoes revertidas (${err.message})`);
  }

  return {
    dryRun: false,
    applied: true,
    layerId,
    from: plan.from,
    to: plan.to,
    directoryMove: plan.directoryMove,
    changes: plan.changes,
    errors: [],
    project: ctx.toJSON(),
  };
}

module.exports = { planLayerRename, applyLayerRename };
