'use strict';

/**
 * Observa as pastas dos projetos abertos (chokidar) e publica no hub:
 *   file:changed | file:added | file:removed   payload: { path, layer, hash?, mtimeMs? }
 *   tree:changed                               payload: { path, kind: 'dirAdded'|'dirRemoved' }
 *
 * `hash` permite a UI ignorar o "eco" das proprias gravacoes (hash == o que ela acabou de salvar).
 * Em volumes Docker no macOS/Windows use STUDIO_WATCH_POLLING=true.
 */

const path = require('path');
const chokidar = require('chokidar');

const toRel = (ctx, abs) => path.relative(ctx.rootPath, abs).split(path.sep).join('/');

function createWatcherService({ registry, hub, files, options = {} }) {
  const watchers = new Map(); // projectId -> FSWatcher
  const readyPromises = new Map();
  const usePolling = options.usePolling ?? process.env.STUDIO_WATCH_POLLING === 'true';
  const stabilityThreshold = options.stabilityThreshold ?? 80;

  async function emitFile(ctx, type, abs) {
    const rel = toRel(ctx, abs);
    if (!rel || ctx.isIgnored(rel)) return;
    const layer = ctx.layerOf(rel);
    const payload = { path: rel, layer: layer ? layer.id : null };
    if (type !== 'file:removed') {
      try {
        const fp = await files.fingerprint(ctx, rel);
        if (fp) Object.assign(payload, { hash: fp.hash, mtimeMs: fp.mtimeMs });
      } catch {
        /* arquivo pode ter sumido entre o evento e a leitura */
      }
    }
    hub.publish(ctx.id, type, payload);
  }

  function watch(ctx) {
    if (watchers.has(ctx.id)) return watchers.get(ctx.id);
    const rel = (abs) => toRel(ctx, abs);
    const watcher = chokidar.watch(ctx.rootPath, {
      ignoreInitial: true,
      persistent: true,
      // So repassa quando true: deixar `undefined` permite ao chokidar escolher
      // (fsevents/inotify/polling conforme a plataforma). `usePolling: false` forcaria fs.watch.
      ...(usePolling ? { usePolling: true, interval: 300 } : {}),
      awaitWriteFinish: { stabilityThreshold, pollInterval: 30 },
      // ignora cedo para nem descer em node_modules/.git/Logs etc.
      ignored: (p) => {
        const r = rel(p);
        return !!r && !r.startsWith('..') && ctx.isIgnored(r);
      },
    });
    watcher
      .on('change', (p) => emitFile(ctx, 'file:changed', p))
      .on('add', (p) => emitFile(ctx, 'file:added', p))
      .on('unlink', (p) => emitFile(ctx, 'file:removed', p))
      .on('addDir', (p) => hub.publish(ctx.id, 'tree:changed', { path: rel(p), kind: 'dirAdded' }))
      .on('unlinkDir', (p) => hub.publish(ctx.id, 'tree:changed', { path: rel(p), kind: 'dirRemoved' }))
      .on('error', (err) => hub.publish(ctx.id, 'watcher:error', { message: err.message }));
    watchers.set(ctx.id, watcher);
    readyPromises.set(ctx.id, new Promise((resolve) => watcher.once('ready', resolve)));
    return watcher;
  }

  async function unwatch(projectId) {
    const w = watchers.get(projectId);
    if (!w) return;
    watchers.delete(projectId);
    readyPromises.delete(projectId);
    await w.close();
  }

  /** Liga o watcher a todos os projetos ja abertos e aos que forem abertos/fechados depois. */
  function start() {
    registry.list().forEach(watch);
    registry.on('opened', watch);
    registry.on('closed', (ctx) => unwatch(ctx.id));
  }

  async function stop() {
    await Promise.all([...watchers.keys()].map(unwatch));
  }

  /** Resolve quando o watcher inicial terminou o scan (util em testes). */
  function ready(projectId) {
    return readyPromises.get(projectId) || Promise.resolve();
  }

  return { start, stop, watch, unwatch, ready };
}

module.exports = { createWatcherService };
