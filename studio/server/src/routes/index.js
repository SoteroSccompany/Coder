'use strict';

/**
 * Carrega AUTOMATICAMENTE todos os modulos desta pasta. Cada fase adiciona o seu arquivo
 * (ex.: `src/routes/blocks.js`) sem editar este index.
 *
 * Contrato de um modulo de rotas:  module.exports = (app, deps) => void
 *   - arquivos `*.js` (exceto index.js e os que comecam com "_") ou pastas com `index.js`;
 *   - ordem de carga: alfabetica (prefixe com numeros se precisar de ordem, ex.: `10-x.js`);
 *   - `deps` = { config, registry, files, watcher, hub, ast, ext } — `deps.ext` e um saco livre
 *     onde uma fase pode pendurar os proprios servicos (ex.: `deps.ext.blocks = ...`).
 */

const fs = require('fs');
const path = require('path');

function loadRoutes(app, deps) {
  const loaded = [];
  const entries = fs.readdirSync(__dirname, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name === 'index.js' || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    let target = null;
    if (e.isFile() && e.name.endsWith('.js')) target = path.join(__dirname, e.name);
    else if (e.isDirectory() && fs.existsSync(path.join(__dirname, e.name, 'index.js'))) {
      target = path.join(__dirname, e.name);
    }
    if (!target) continue;
    const mod = require(target);
    const register = typeof mod === 'function' ? mod : mod && mod.default;
    if (typeof register !== 'function') {
      throw new Error(`Modulo de rotas invalido (esperado: (app, deps) => void): ${e.name}`);
    }
    register(app, deps);
    loaded.push(e.name);
  }
  return loaded;
}

module.exports = { loadRoutes };
