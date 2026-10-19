'use strict';

/**
 * Abstracao de "projeto ativo".
 *
 * Um contexto (ProjectContext) representa UM projeto aberto: pasta raiz, manifesto
 * (`studio.project.json`, quando existir) e utilitarios seguros de caminho.
 * O registro (ProjectRegistry) guarda varios projetos abertos (mapa id -> contexto).
 *
 * STUB FUNCIONAL: a fase `projects` expande criacao/import/recentes. Para isso ela deve
 * criar arquivos NOVOS em `src/projects/` e usar `registry.open()/close()` daqui.
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { HttpError } = require('../util/httpError');

const MANIFEST_FILE = 'studio.project.json';

/** Defaults que reproduzem o layout atual de `api/`. */
const DEFAULT_LAYERS = Object.freeze({
  domain: { path: '@core/domain', editor: 'domain-form' },
  usecase: { path: '@core/usecase', editor: 'blocks' },
  repository: { path: 'infrastructure/db/services', editor: 'text' },
  controller: { path: 'infrastructure/Controllers', editor: 'text' },
  routes: { path: 'infrastructure/routes', editor: 'text' },
  worker: { path: 'infrastructure/queue/workers', editor: 'text' },
  gateway: { path: 'infrastructure/gateways', editor: 'text' },
  migration: { path: 'knex/migrations', editor: 'text' },
});

/** Sempre ignorados (o manifesto pode ACRESCENTAR, nunca remover). */
const DEFAULT_IGNORE = Object.freeze(['.env', 'security', 'Logs', 'node_modules', '.git']);

/** Normaliza separadores e remove "./" e "/" nas pontas. */
function normalizeRel(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/** Converte um glob simples (`*`, `**`) em RegExp ancorada. */
function globToRegExp(glob) {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`);
}

/**
 * Normaliza uma camada do manifesto. Aceita string ("@core/domain") ou objeto.
 * `path` pode ter placeholders (`@core/usecase/{Entity}`): `basePath` e a parte fixa
 * antes do primeiro segmento com `{`.
 */
function normalizeLayer(id, raw) {
  const obj = typeof raw === 'string' ? { path: raw } : { ...(raw || {}) };
  const layerPath = normalizeRel(obj.path);
  const segs = layerPath.split('/');
  const idx = segs.findIndex((s) => s.includes('{'));
  const basePath = idx === -1 ? layerPath : segs.slice(0, idx).join('/');
  return { ...obj, id, path: layerPath, basePath, editor: obj.editor || 'text' };
}

class ProjectContext {
  /**
   * @param {{id:string, rootPath:string}} opts
   */
  constructor({ id, rootPath }) {
    this.id = id;
    this.rootPath = rootPath;
    this.manifestPath = path.join(rootPath, MANIFEST_FILE);
    this.hasManifest = false;
    this.manifest = {};
    this.layers = [];
    this.ignore = [];
    this._ignoreMatchers = [];
    this.reload();
  }

  /** (Re)le o manifesto e recalcula layers/ignore. */
  reload() {
    let raw = {};
    this.hasManifest = fs.existsSync(this.manifestPath);
    if (this.hasManifest) {
      try {
        raw = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
      } catch (err) {
        throw new HttpError(422, 'MANIFEST_INVALID', `${MANIFEST_FILE} invalido: ${err.message}`);
      }
    }

    const layersRaw = { ...DEFAULT_LAYERS, ...(raw.layers || {}) };
    this.layers = Object.entries(layersRaw).map(([lid, l]) => normalizeLayer(lid, l));

    this.ignore = [...new Set([...DEFAULT_IGNORE, ...(raw.ignore || []).map(normalizeRel)])];
    this._ignoreMatchers = this.ignore.map((entry) => ({
      entry,
      hasSlash: entry.includes('/'),
      re: entry.includes('*') ? globToRegExp(entry) : null,
    }));

    this.manifest = {
      name: raw.name || path.basename(this.rootPath),
      runtime: raw.runtime || 'node',
      entry: raw.entry || 'index.js',
      port: raw.port,
      naming: raw.naming || {},
      fileTemplates: raw.fileTemplates || {},
      services: raw.services || {},
      blocks: raw.blocks || [],
      ...raw,
      layers: Object.fromEntries(this.layers.map((l) => [l.id, l])),
      ignore: this.ignore,
    };
    return this;
  }

  /** True se o caminho relativo (ao root) e ignorado pelo manifesto. */
  isIgnored(rel) {
    const r = normalizeRel(rel);
    if (!r) return false;
    const segs = r.split('/');
    return this._ignoreMatchers.some(({ entry, hasSlash, re }) => {
      if (re) {
        // glob: casa contra o caminho inteiro ou contra qualquer prefixo/segmento
        if (re.test(r)) return true;
        if (!hasSlash) return segs.some((s) => re.test(s));
        return segs.some((_, i) => re.test(segs.slice(0, i + 1).join('/')));
      }
      if (!hasSlash) return segs.includes(entry); // ex.: ".env" em qualquer nivel
      return r === entry || r.startsWith(`${entry}/`);
    });
  }

  /**
   * Resolve um caminho relativo para absoluto GARANTINDO que fica dentro do root
   * (bloqueia `..`, caminho absoluto, byte nulo e escape via symlink).
   * NAO checa `ignore` (use `assertAccessible` para isso).
   * @returns {{rel:string, abs:string}}
   */
  resolvePath(relInput) {
    if (typeof relInput !== 'string' || relInput.length === 0) {
      throw HttpError.badRequest('PATH_REQUIRED', 'Parametro path obrigatorio');
    }
    if (relInput.includes('\0')) {
      throw HttpError.badRequest('PATH_INVALID', 'Caminho invalido');
    }
    const unified = relInput.replace(/\\/g, '/');
    if (path.isAbsolute(unified) || /^[a-zA-Z]:/.test(unified)) {
      throw HttpError.forbidden('PATH_TRAVERSAL', 'Caminho absoluto nao permitido');
    }
    const abs = path.resolve(this.rootPath, unified);
    const relFromRoot = path.relative(this.rootPath, abs);
    if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
      throw HttpError.forbidden('PATH_TRAVERSAL', 'Caminho fora do projeto');
    }

    // Protecao contra symlink: o ancestral existente mais profundo deve estar dentro do root real.
    const realRoot = fs.realpathSync(this.rootPath);
    let probe = abs;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const realProbe = fs.realpathSync(probe);
    const relReal = path.relative(realRoot, realProbe);
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
      throw HttpError.forbidden('PATH_TRAVERSAL', 'Caminho aponta para fora do projeto');
    }

    return { rel: normalizeRel(relFromRoot.split(path.sep).join('/')), abs };
  }

  /** `resolvePath` + bloqueio de caminhos ignorados (.env, security...). */
  assertAccessible(relInput) {
    const resolved = this.resolvePath(relInput);
    if (this.isIgnored(resolved.rel)) {
      throw HttpError.forbidden('PATH_IGNORED', 'Caminho ignorado pelo projeto');
    }
    return resolved;
  }

  /** Camada a que um caminho relativo pertence (match mais especifico) ou null. */
  layerOf(rel) {
    const r = normalizeRel(rel);
    let best = null;
    for (const layer of this.layers) {
      const base = layer.basePath;
      if (!base) continue;
      if (r === base || r.startsWith(`${base}/`)) {
        if (!best || base.length > best.basePath.length) best = layer;
      }
    }
    return best;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.manifest.name,
      rootPath: this.rootPath,
      hasManifest: this.hasManifest,
      archived: !!this.manifest.archived,
      entry: this.manifest.entry || 'index.js',
      port: this.manifest.port ?? null,
      layers: this.layers,
      ignore: this.ignore,
    };
  }
}

/**
 * Registro de projetos abertos (id -> contexto).
 * Eventos: 'opened' (ctx), 'closed' (ctx).
 */
class ProjectRegistry extends EventEmitter {
  constructor() {
    super();
    this.projects = new Map();
  }

  _makeId(rootPath, wanted) {
    const base =
      String(wanted || path.basename(rootPath) || 'projeto')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'projeto';
    let id = base;
    let n = 2;
    while (this.projects.has(id)) id = `${base}-${n++}`;
    return id;
  }

  /** Abre (ou devolve, se ja aberto) o projeto em `rootPath`. */
  open(rootPath, { id } = {}) {
    const abs = path.resolve(rootPath);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw HttpError.notFound('PROJECT_PATH_NOT_FOUND', `Pasta nao encontrada: ${abs}`);
    }
    if (!stat.isDirectory()) {
      throw HttpError.badRequest('PROJECT_PATH_NOT_DIR', `Nao e uma pasta: ${abs}`);
    }
    const real = fs.realpathSync(abs);
    for (const ctx of this.projects.values()) {
      if (ctx.rootPath === real) return ctx;
    }
    const ctx = new ProjectContext({ id: this._makeId(real, id), rootPath: real });
    this.projects.set(ctx.id, ctx);
    this.emit('opened', ctx);
    return ctx;
  }

  close(id) {
    const ctx = this.projects.get(id);
    if (!ctx) return false;
    this.projects.delete(id);
    this.emit('closed', ctx);
    return true;
  }

  get(id) {
    return this.projects.get(id) || null;
  }

  /** Como `get`, mas lanca 404 (use nas rotas). */
  require(id) {
    const ctx = this.projects.get(id);
    if (!ctx) throw HttpError.notFound('PROJECT_NOT_FOUND', `Projeto nao aberto: ${id}`);
    return ctx;
  }

  list() {
    return [...this.projects.values()];
  }
}

module.exports = {
  MANIFEST_FILE,
  DEFAULT_LAYERS,
  DEFAULT_IGNORE,
  ProjectContext,
  ProjectRegistry,
  createProjectRegistry: () => new ProjectRegistry(),
  normalizeRel,
};
