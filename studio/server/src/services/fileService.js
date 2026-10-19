'use strict';

/**
 * Leitura/escrita segura de arquivos de um projeto.
 * - protecao contra path traversal e caminhos ignorados (via ProjectContext);
 * - hash sha256 (autoridade) + mtime (informativo) para deteccao de conflito;
 * - escrita atomica (arquivo temporario + rename) e serializada por arquivo.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { HttpError } = require('../util/httpError');

const MAX_FILE_BYTES = Number(process.env.STUDIO_MAX_FILE_BYTES || 2 * 1024 * 1024);
const MAX_TREE_ENTRIES = 20000;

const sha256 = (bufOrStr) => crypto.createHash('sha256').update(bufOrStr).digest('hex');

function createFileService() {
  const locks = new Map(); // abs -> Promise (fila por arquivo)

  async function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((r) => (release = r));
    const chained = prev.then(() => next);
    locks.set(key, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === chained) locks.delete(key);
    }
  }

  async function statOrNull(abs) {
    try {
      return await fsp.stat(abs);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Le um arquivo texto. Retorna { path, content, hash, mtimeMs, size, layer }. */
  async function readFile(ctx, relInput) {
    const { rel, abs } = ctx.assertAccessible(relInput);
    const st = await statOrNull(abs);
    if (!st) throw HttpError.notFound('FILE_NOT_FOUND', `Arquivo nao encontrado: ${rel}`);
    if (!st.isFile()) throw HttpError.badRequest('NOT_A_FILE', `Nao e um arquivo: ${rel}`);
    if (st.size > MAX_FILE_BYTES) {
      throw new HttpError(413, 'FILE_TOO_LARGE', `Arquivo maior que ${MAX_FILE_BYTES} bytes`);
    }
    const buf = await fsp.readFile(abs);
    if (buf.includes(0)) {
      throw new HttpError(415, 'FILE_BINARY', 'Arquivo binario nao e suportado');
    }
    const layer = ctx.layerOf(rel);
    return {
      path: rel,
      content: buf.toString('utf8'),
      hash: sha256(buf),
      mtimeMs: st.mtimeMs,
      size: st.size,
      layer: layer ? layer.id : null,
    };
  }

  /** Calcula hash/mtime sem devolver o conteudo (usado pelo watcher). Retorna null se nao existir. */
  async function fingerprint(ctx, relInput) {
    const { abs } = ctx.assertAccessible(relInput);
    const st = await statOrNull(abs);
    if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const buf = await fsp.readFile(abs);
    return { hash: sha256(buf), mtimeMs: st.mtimeMs, size: st.size };
  }

  /**
   * Grava um arquivo exigindo `baseHash` (hash lido pelo cliente).
   * - arquivo existente: baseHash deve ser igual ao hash atual, senao 409 CONFLICT;
   * - arquivo novo: baseHash deve ser `null` (se o arquivo existir -> 409).
   */
  async function writeFile(ctx, relInput, content, baseHash) {
    if (baseHash === undefined) {
      throw HttpError.badRequest('BASE_HASH_REQUIRED', 'baseHash e obrigatorio (use null para arquivo novo)');
    }
    if (typeof content !== 'string') {
      throw HttpError.badRequest('CONTENT_REQUIRED', 'content (string) e obrigatorio');
    }
    const data = Buffer.from(content, 'utf8');
    if (data.length > MAX_FILE_BYTES) {
      throw new HttpError(413, 'FILE_TOO_LARGE', `Conteudo maior que ${MAX_FILE_BYTES} bytes`);
    }
    const { rel, abs } = ctx.assertAccessible(relInput);

    return withLock(abs, async () => {
      const st = await statOrNull(abs);
      if (st && !st.isFile()) throw HttpError.badRequest('NOT_A_FILE', `Nao e um arquivo: ${rel}`);

      if (st) {
        const current = await fsp.readFile(abs);
        const currentHash = sha256(current);
        if (baseHash !== currentHash) {
          throw HttpError.conflict('CONFLICT', 'O arquivo foi alterado desde a leitura', {
            path: rel,
            baseHash,
            currentHash,
            currentMtimeMs: st.mtimeMs,
            currentContent: current.includes(0) ? undefined : current.toString('utf8'),
          });
        }
      } else if (baseHash !== null) {
        throw HttpError.conflict('CONFLICT', 'O arquivo nao existe mais', {
          path: rel,
          baseHash,
          currentHash: null,
        });
      }

      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.studio-${process.pid}-${Date.now()}.tmp`;
      await fsp.writeFile(tmp, data, st ? { mode: st.mode } : undefined);
      await fsp.rename(tmp, abs);
      const after = await fsp.stat(abs);
      return { path: rel, hash: sha256(data), mtimeMs: after.mtimeMs, size: after.size, created: !st };
    });
  }

  /**
   * Arvore de diretorio (respeita ignore). Nos: { name, path, type: 'dir'|'file', children? }.
   * `exclude(rel)` poda caminhos (usado para montar o grupo "outros").
   */
  async function listTree(ctx, startRel = '', { exclude, pruneEmptyDirs } = {}) {
    let count = 0;
    const startAbs = startRel ? ctx.resolvePath(startRel).abs : ctx.rootPath;

    async function walk(abs, rel) {
      let entries;
      try {
        entries = await fsp.readdir(abs, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
        throw err;
      }
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const nodes = [];
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (ctx.isIgnored(childRel)) continue;
        if (exclude && exclude(childRel)) continue;
        if (++count > MAX_TREE_ENTRIES) return nodes;
        if (e.isDirectory()) {
          const children = await walk(path.join(abs, e.name), childRel);
          if (pruneEmptyDirs && pruneEmptyDirs(childRel) && children.length === 0) continue;
          nodes.push({ name: e.name, path: childRel, type: 'dir', children });
        } else if (e.isFile()) {
          nodes.push({ name: e.name, path: childRel, type: 'file' });
        }
        // symlinks e outros tipos sao omitidos de proposito
      }
      return nodes;
    }

    return walk(startAbs, startRel.replace(/\/+$/, ''));
  }

  /**
   * Arvore agrupada por layer:
   * { projectId, layers: [{ id, path, basePath, editor, exists, children }], other: [...] }
   */
  async function treeByLayer(ctx) {
    const layers = [];
    for (const layer of ctx.layers) {
      const exists = !!layer.basePath && fs.existsSync(path.join(ctx.rootPath, layer.basePath));
      const children = exists ? await listTree(ctx, layer.basePath) : [];
      layers.push({
        id: layer.id,
        path: layer.path,
        basePath: layer.basePath,
        editor: layer.editor,
        exists,
        children,
      });
    }
    const layerBases = ctx.layers.map((l) => l.basePath).filter(Boolean);
    const inLayer = (rel) => layerBases.some((b) => rel === b || rel.startsWith(`${b}/`));
    const isAncestorOfLayer = (rel) => layerBases.some((b) => b.startsWith(`${rel}/`));
    const other = await listTree(ctx, '', { exclude: inLayer, pruneEmptyDirs: isAncestorOfLayer });
    return { projectId: ctx.id, name: ctx.manifest.name, layers, other };
  }

  return { readFile, writeFile, fingerprint, listTree, treeByLayer, sha256 };
}

module.exports = { createFileService, sha256, MAX_FILE_BYTES };
