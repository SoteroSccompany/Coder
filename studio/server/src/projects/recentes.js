'use strict';

const fs = require('fs');
const { recentesFile, writeAtomic } = require('./paths');

const MAX = 30;

function load() {
  const file = recentesFile();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = Array.isArray(raw) ? raw : raw.items || [];
    return items.filter((it) => it && typeof it.rootPath === 'string');
  } catch {
    return [];
  }
}

function save(items) {
  writeAtomic(recentesFile(), `${JSON.stringify({ items }, null, 2)}\n`);
}

function touch({ rootPath, name, archived = false }) {
  const items = load().filter((it) => it.rootPath !== rootPath);
  items.unshift({
    rootPath,
    name: name || rootPath,
    openedAt: new Date().toISOString(),
    archived: !!archived,
  });
  save(items.slice(0, MAX));
  return list();
}

function markArchived(rootPath, archived) {
  const items = load();
  let found = false;
  for (const it of items) {
    if (it.rootPath === rootPath) {
      it.archived = !!archived;
      found = true;
    }
  }
  if (!found && archived) {
    items.unshift({ rootPath, name: rootPath, openedAt: new Date().toISOString(), archived: true });
  }
  save(items.slice(0, MAX));
  return list();
}

function remove(rootPath) {
  save(load().filter((it) => it.rootPath !== rootPath));
  return list();
}

function list() {
  const items = load();
  return {
    recentes: items.filter((it) => !it.archived),
    archived: items.filter((it) => it.archived),
  };
}

module.exports = { touch, markArchived, remove, list, load };
