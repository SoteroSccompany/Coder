'use strict';

/**
 * Fachada da fase projects/customization. Sem estado alem do arquivo de recentes.
 */

const fs = require('fs');
const path = require('path');
const { HttpError } = require('../util/httpError');
const { DEFAULT_IGNORE } = require('../context/projectContext');
const {
  resolveUserPath,
  assertExistingDir,
  projectsDir,
  userTemplatesDir,
  studioTemplatesDir,
  slugify,
  assertSafeSlug,
  uniqueDest,
  writeAtomic,
  workspaceRoot,
} = require('./paths');
const { readRaw, writeManifest, cleanLayers } = require('./manifest');
const { detectProjectLayout } = require('./detectLayout');
const recentes = require('./recentes');
const { suggestPorts } = require('./ports');
const { listTemplates, loadTemplate, copyTree } = require('./templates');
const { createFromTemplate, ensureBlocksDir } = require('./scaffold');
const { planLayerRename, applyLayerRename } = require('./renameLayer');
const { validateComposeFile } = require('./compose');

const BUILTIN_TEMPLATES = new Set(['api-clean', 'api-minima', 'worker-fila']);
const ENV_EXAMPLE = 'env-example.txt';

function takenPorts(registry) {
  const ports = [];
  for (const ctx of registry.list()) {
    if (ctx.manifest && ctx.manifest.port) ports.push(ctx.manifest.port);
  }
  return ports;
}

function publish(deps, ctx, type, payload) {
  try {
    deps.hub.publish(ctx ? ctx.id : null, type, payload || {});
  } catch {
    /* hub opcional nos testes */
  }
}

function createProjectApi(deps) {
  const { registry } = deps;

  function openResolved(abs) {
    const ctx = registry.open(abs);
    recentes.touch({ rootPath: ctx.rootPath, name: ctx.manifest.name, archived: !!ctx.manifest.archived });
    publish(deps, ctx, 'projects:opened', { id: ctx.id, rootPath: ctx.rootPath });
    return ctx;
  }

  return {
    recentes() {
      return recentes.list();
    },

    forgetRecente(rootPath) {
      const abs = resolveUserPath(rootPath);
      return recentes.remove(abs);
    },

    templates() {
      return { templates: listTemplates().map(({ dir, ...rest }) => rest) };
    },

    template(id, source) {
      const meta = loadTemplate(id, source);
      const { dir, ...rest } = meta;
      return rest;
    },

    async ports() {
      return suggestPorts({ taken: takenPorts(registry) });
    },

    workspace() {
      const dir = projectsDir();
      const items = [];
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir)) {
          const root = path.join(dir, name);
          let stat;
          try {
            stat = fs.statSync(root);
          } catch {
            continue;
          }
          if (!stat.isDirectory()) continue;
          const raw = readRaw(root);
          if (!raw) continue;
          items.push({
            slug: name,
            name: raw.name || name,
            rootPath: root,
            archived: !!raw.archived,
            port: raw.port ?? null,
            template: raw.template || null,
          });
        }
      }
      return {
        workspace: workspaceRoot(),
        projectsDir: dir,
        userTemplates: userTemplatesDir(),
        projects: items.filter((p) => !p.archived),
        archived: items.filter((p) => p.archived),
      };
    },

    open(body) {
      const abs = assertExistingDir(resolveUserPath(body.path || body.rootPath));
      const detection = detectProjectLayout(abs);
      if (!detection.hasManifest) {
        return { opened: false, needsImport: true, detection };
      }
      const ctx = openResolved(abs);
      return { opened: true, needsImport: false, project: ctx.toJSON() };
    },

    previewImport(body) {
      const abs = assertExistingDir(resolveUserPath(body.path || body.rootPath));
      return detectProjectLayout(abs);
    },

    importProject(body) {
      if (body.confirm !== true) {
        throw HttpError.badRequest('CONFIRM_REQUIRED', 'Confirme o import (confirm: true). A previa nao grava o manifesto.');
      }
      const abs = assertExistingDir(resolveUserPath(body.path || body.rootPath));
      const detection = detectProjectLayout(abs);
      if (detection.hasManifest) {
        throw HttpError.conflict('ALREADY_HAS_MANIFEST', 'A pasta ja tem studio.project.json. Abra o projeto.');
      }
      writeManifest(abs, detection.manifest);
      const ctx = openResolved(abs);
      publish(deps, ctx, 'projects:imported', { id: ctx.id, rootPath: ctx.rootPath });
      return { opened: true, wrote: true, project: ctx.toJSON(), manifest: detection.manifest };
    },

    async create(body) {
      const created = await createFromTemplate({ body, takenPorts: takenPorts(registry) });
      const ctx = openResolved(created.dest);
      publish(deps, ctx, 'projects:created', { id: ctx.id, template: created.template.id });
      return {
        project: ctx.toJSON(),
        template: created.template.id,
        slug: created.slug,
        compose: { engine: created.validation.engine },
      };
    },

    close(id) {
      const ctx = registry.require(id);
      const info = ctx.toJSON();
      registry.close(id);
      publish(deps, null, 'projects:closed', { id, rootPath: info.rootPath });
      return { closed: true, id, rootPath: info.rootPath };
    },

    async clone(id, body) {
      const ctx = registry.require(id);
      const name = String(body.name || `${ctx.manifest.name} copia`).trim();
      if (!name) throw HttpError.badRequest('NAME_REQUIRED', 'Informe o nome da copia');
      const slug = slugify(body.slug || name);
      fs.mkdirSync(projectsDir(), { recursive: true });
      const dest = uniqueDest(projectsDir(), slug);
      copyTree(ctx.rootPath, dest, {});
      const raw = readRaw(dest) || {};
      raw.name = name;
      raw.archived = false;
      raw.template = raw.template || ctx.manifest.template;
      if (body.port) raw.port = Number(body.port);
      else {
        const suggested = await suggestPorts({ taken: takenPorts(registry).concat(ctx.manifest.port || []) });
        raw.port = suggested.port;
      }
      writeManifest(dest, raw);
      patchPortLine(path.join(dest, '.env'), raw.port);
      patchPortLine(path.join(dest, ENV_EXAMPLE), raw.port);
      const composePath = path.join(dest, 'docker-compose.yaml');
      if (fs.existsSync(composePath)) {
        try {
          validateComposeFile(composePath);
        } catch {
          /* a copia mantem o compose do original; a validacao completa e da criacao */
        }
      }
      const copy = openResolved(dest);
      return { project: copy.toJSON(), slug: path.basename(dest) };
    },

    archiveByPath(input) {
      const abs = assertExistingDir(resolveUserPath(input));
      const raw = readRaw(abs);
      if (!raw) throw HttpError.badRequest('MANIFEST_REQUIRED', 'A pasta nao tem studio.project.json');
      raw.archived = true;
      writeManifest(abs, raw);
      recentes.markArchived(abs, true);
      for (const ctx of registry.list()) {
        if (ctx.rootPath === abs) {
          registry.close(ctx.id);
          break;
        }
      }
      return { archived: true, rootPath: abs, name: raw.name || path.basename(abs) };
    },

    archive(id) {
      const ctx = registry.require(id);
      return this.archiveByPath(ctx.rootPath);
    },

    unarchive(body) {
      const abs = assertExistingDir(resolveUserPath(body.path || body.rootPath));
      const raw = readRaw(abs);
      if (!raw) throw HttpError.badRequest('MANIFEST_REQUIRED', 'A pasta nao tem studio.project.json');
      raw.archived = false;
      writeManifest(abs, raw);
      const ctx = openResolved(abs);
      recentes.markArchived(abs, false);
      recentes.touch({ rootPath: ctx.rootPath, name: ctx.manifest.name, archived: false });
      return { project: ctx.toJSON() };
    },

    saveTemplate(id, body) {
      const ctx = registry.require(id);
      const name = assertSafeSlug(slugify(body.name || body.id || ctx.manifest.name));
      const destination = body.destination === 'studio' ? 'studio' : 'user';
      if (destination === 'studio' && BUILTIN_TEMPLATES.has(name) && body.overwrite !== true) {
        throw HttpError.conflict('TEMPLATE_BUILTIN', `O template ${name} e interno. Escolha outro nome ou grave na pasta do usuario.`);
      }
      const base = destination === 'studio' ? studioTemplatesDir() : userTemplatesDir();
      const dest = path.join(base, name);
      if (fs.existsSync(dest)) {
        if (body.overwrite !== true) throw HttpError.conflict('TEMPLATE_EXISTS', `Ja existe o template ${name}`);
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyTree(ctx.rootPath, dest, { skipNames: ['.env', 'template.json'] });
      const suggested = Object.entries(ctx.manifest.services || {})
        .filter(([, v]) => v && v.enabled)
        .map(([k]) => k);
      const meta = {
        id: name,
        label: body.label || ctx.manifest.name || name,
        description: body.description || `Template salvo a partir de ${ctx.manifest.name}`,
        entry: ctx.manifest.entry || 'index.js',
        questions: [
          { id: 'name', label: 'Nome do projeto', type: 'text', required: true },
          { id: 'port', label: 'Porta', type: 'port', required: true },
          { id: 'database', label: 'Banco de dados', type: 'text' },
          { id: 'services', label: 'Servicos', type: 'services', options: ['mysql', 'redis', 'rabbitmq', 'mailpit'] },
        ],
        services: ['mysql', 'redis', 'rabbitmq', 'mailpit'],
        suggestedServices: suggested,
        blocks: ctx.manifest.blocks || ['core', '.studio/blocks'],
        layers: cleanLayers(ctx.manifest.layers),
      };
      writeAtomic(path.join(dest, 'template.json'), `${JSON.stringify(meta, null, 2)}\n`);
      return {
        id: name,
        source: destination,
        dir: dest,
        userTemplates: userTemplatesDir(),
      };
    },

    ensureBlocks(id) {
      const ctx = registry.require(id);
      ensureBlocksDir(ctx.rootPath);
      const raw = readRaw(ctx.rootPath);
      if (raw) {
        const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
        if (!blocks.includes('core')) blocks.unshift('core');
        if (!blocks.includes('.studio/blocks')) blocks.push('.studio/blocks');
        raw.blocks = blocks;
        writeManifest(ctx.rootPath, raw);
        ctx.reload();
      }
      return { path: '.studio/blocks', project: ctx.toJSON() };
    },

    getManifest(id) {
      const ctx = registry.require(id);
      const raw = readRaw(ctx.rootPath);
      return {
        hasManifest: ctx.hasManifest,
        manifest: raw || {
          name: ctx.manifest.name,
          runtime: ctx.manifest.runtime,
          entry: ctx.manifest.entry,
          port: ctx.manifest.port,
          layers: cleanLayers(ctx.manifest.layers),
          naming: ctx.manifest.naming || {},
          fileTemplates: ctx.manifest.fileTemplates || {},
          services: ctx.manifest.services || {},
          blocks: ctx.manifest.blocks || [],
          ignore: ctx.ignore,
        },
        effectiveIgnore: ctx.ignore,
        defaultIgnore: [...DEFAULT_IGNORE],
      };
    },

    updateManifest(id, patch) {
      const ctx = registry.require(id);
      const current = readRaw(ctx.rootPath) || this.getManifest(id).manifest;
      if (patch.layers && typeof patch.layers === 'object') {
        const prevLayers = current.layers || {};
        for (const [layerId, layer] of Object.entries(patch.layers)) {
          if (!layer || typeof layer.path !== 'string') continue;
          const prev = prevLayers[layerId];
          if (prev && normalizePath(prev.path) !== normalizePath(layer.path)) {
            throw HttpError.badRequest(
              'USE_LAYER_MOVE',
              `Para mudar o caminho da camada ${layerId}, use a previa de movimentacao`,
              { layerId },
            );
          }
        }
      }
      const next = applyManifestPatch(current, patch);
      writeManifest(ctx.rootPath, next);
      ctx.reload();
      publish(deps, ctx, 'projects:manifest', { id: ctx.id });
      return { manifest: readRaw(ctx.rootPath), project: ctx.toJSON(), effectiveIgnore: ctx.ignore };
    },

    async getEnvExample(id) {
      const ctx = registry.require(id);
      try {
        return await deps.files.readFile(ctx, ENV_EXAMPLE);
      } catch (err) {
        if (err && err.code === 'FILE_NOT_FOUND') {
          return { path: ENV_EXAMPLE, content: '', hash: null, missing: true };
        }
        throw err;
      }
    },

    async putEnvExample(id, body) {
      const ctx = registry.require(id);
      if (body && (body.path === '.env' || body.file === '.env')) {
        throw HttpError.forbidden('PATH_IGNORED', 'O .env real nao e editado por aqui');
      }
      const result = await deps.files.writeFile(ctx, ENV_EXAMPLE, body.content, body.baseHash);
      return result;
    },

    renameLayer(id, body) {
      const ctx = registry.require(id);
      const layerId = body.layerId || body.id;
      const nextPath = body.path;
      if (!layerId || typeof nextPath !== 'string') {
        throw HttpError.badRequest('LAYER_REQUIRED', 'Informe layerId e path');
      }
      if (body.dryRun === true) {
        const plan = planLayerRename({ ctx, ast: deps.ast, layerId, nextPath });
        return {
          dryRun: true,
          wrote: false,
          layerId: plan.layerId,
          from: plan.from,
          to: plan.to,
          directoryMove: plan.directoryMove,
          changes: plan.changes,
          errors: plan.errors,
        };
      }
      if (body.confirm !== true) {
        throw HttpError.badRequest('CONFIRM_REQUIRED', 'Peca a previa (dryRun: true) ou confirme (confirm: true)');
      }
      const applied = applyLayerRename({ ctx, ast: deps.ast, layerId, nextPath });
      publish(deps, ctx, 'projects:layer-moved', { layerId, from: applied.from, to: applied.to });
      return applied;
    },
  };
}

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function applyManifestPatch(current, patch) {
  const next = { ...current };
  if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim().slice(0, 80);
  if (patch.runtime != null && patch.runtime !== 'node') {
    throw HttpError.badRequest('RUNTIME_UNSUPPORTED', 'Nesta fase o runtime e node');
  }
  if (patch.runtime) next.runtime = 'node';
  if (typeof patch.entry === 'string') {
    const entry = normalizePath(patch.entry);
    if (!entry || entry.split('/').includes('..')) throw HttpError.badRequest('ENTRY_INVALID', 'Entry invalido');
    next.entry = entry;
  }
  if (patch.port === null) next.port = null;
  else if (patch.port != null) {
    const port = Number(patch.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw HttpError.badRequest('PORT_INVALID', 'Porta invalida');
    next.port = port;
  }
  if (patch.layers && typeof patch.layers === 'object') {
    const layers = { ...(current.layers || {}) };
    for (const [id, layer] of Object.entries(patch.layers)) {
      if (!/^[a-z0-9][a-z0-9_-]{0,48}$/.test(id)) throw HttpError.badRequest('LAYER_INVALID', `Id de camada invalido: ${id}`);
      if (!layer || typeof layer !== 'object') throw HttpError.badRequest('LAYER_INVALID', `Camada invalida: ${id}`);
      const prev = layers[id] || {};
      const merged = { ...prev, ...layer };
      delete merged.id;
      delete merged.basePath;
      if (typeof merged.path !== 'string' || !merged.path) throw HttpError.badRequest('LAYER_INVALID', `Camada ${id} sem path`);
      if (merged.editor != null && typeof merged.editor !== 'string') throw HttpError.badRequest('LAYER_INVALID', 'Editor invalido');
      if (merged.file != null && typeof merged.file !== 'string') throw HttpError.badRequest('LAYER_INVALID', 'Padrao de arquivo invalido');
      layers[id] = merged;
    }
    if (Array.isArray(patch.removeLayers)) {
      for (const id of patch.removeLayers) delete layers[id];
    }
    next.layers = layers;
  }
  if (patch.naming && typeof patch.naming === 'object') {
    const naming = { ...(current.naming || {}) };
    for (const [k, v] of Object.entries(patch.naming)) {
      if (typeof v !== 'string') throw HttpError.badRequest('NAMING_INVALID', `Convenção ${k} deve ser texto`);
      naming[k] = v;
    }
    next.naming = naming;
  }
  if (patch.fileTemplates && typeof patch.fileTemplates === 'object') {
    const fileTemplates = { ...(current.fileTemplates || {}) };
    for (const [k, v] of Object.entries(patch.fileTemplates)) {
      if (typeof v !== 'string') throw HttpError.badRequest('TEMPLATE_INVALID', `Template ${k} deve ser texto`);
      if (v.length > 100000) throw HttpError.badRequest('TEMPLATE_INVALID', `Template ${k} muito grande`);
      fileTemplates[k] = v;
    }
    next.fileTemplates = fileTemplates;
  }
  if (patch.services && typeof patch.services === 'object') {
    next.services = { ...(current.services || {}), ...patch.services };
  }
  if (Array.isArray(patch.blocks)) {
    next.blocks = patch.blocks.filter((b) => typeof b === 'string');
  }
  if (Array.isArray(patch.ignore)) {
    next.ignore = patch.ignore
      .filter((x) => typeof x === 'string')
      .map((x) => normalizePath(x))
      .filter((x) => x && !x.split('/').includes('..'));
  }
  if (typeof patch.archived === 'boolean') next.archived = patch.archived;
  return next;
}

function patchPortLine(file, port) {
  if (!fs.existsSync(file) || port == null) return;
  const text = fs.readFileSync(file, 'utf8');
  if (!/^PORT\s*=/m.test(text)) return;
  fs.writeFileSync(file, text.replace(/^PORT\s*=.*$/m, `PORT=${port}`));
}

function projectApi(deps) {
  if (!deps.ext.projects) deps.ext.projects = createProjectApi(deps);
  return deps.ext.projects;
}

module.exports = { createProjectApi, projectApi, applyManifestPatch };
