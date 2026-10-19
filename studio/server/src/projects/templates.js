'use strict';

const fs = require('fs');
const path = require('path');
const { HttpError } = require('../util/httpError');
const { studioTemplatesDir, userTemplatesDir, assertSafeSlug } = require('./paths');
const { render } = require('./render');

function readTemplateJson(dir) {
  const file = path.join(dir, 'template.json');
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new HttpError(422, 'TEMPLATE_INVALID', `template.json invalido em ${dir}: ${err.message}`);
  }
  if (!raw || typeof raw.id !== 'string') {
    throw new HttpError(422, 'TEMPLATE_INVALID', `template.json sem id em ${dir}`);
  }
  return raw;
}

function listDir(dir, source) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isDirectory() || name.startsWith('.') || name.startsWith('_')) continue;
    const meta = readTemplateJson(abs);
    if (!meta) continue;
    out.push(summarize(meta, source, abs));
  }
  return out;
}

function summarize(meta, source, dir) {
  return {
    id: meta.id,
    label: meta.label || meta.id,
    description: meta.description || '',
    source,
    dir,
    questions: meta.questions || [],
    services: meta.services || ['mysql', 'redis', 'rabbitmq', 'mailpit'],
    suggestedServices: meta.suggestedServices || [],
    blocks: meta.blocks || ['core', '.studio/blocks'],
    entry: meta.entry || 'index.js',
  };
}

function listTemplates() {
  const studio = listDir(studioTemplatesDir(), 'studio');
  const user = listDir(userTemplatesDir(), 'user');
  return [...studio, ...user];
}

function loadTemplate(id, source) {
  assertSafeSlug(id);
  const sources = [];
  if (!source || source === 'studio') sources.push(['studio', studioTemplatesDir()]);
  if (!source || source === 'user') sources.push(['user', userTemplatesDir()]);
  for (const [src, dir] of sources) {
    const abs = path.join(dir, id);
    if (!fs.existsSync(path.join(abs, 'template.json'))) continue;
    const meta = readTemplateJson(abs);
    if (meta.id !== id) continue;
    return { ...meta, source: src, dir: abs };
  }
  throw HttpError.notFound('TEMPLATE_NOT_FOUND', `Template nao encontrado: ${id}`);
}

const SKIP_COPY = new Set(['node_modules', '.git', 'coverage', 'dist', 'Logs']);

function copyTree(src, dest, { skipNames = [], renderVars = null, enabled = null } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  const skip = new Set([...SKIP_COPY, ...skipNames]);
  function walk(from, to) {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (skip.has(e.name) || e.isSymbolicLink()) continue;
      const fromAbs = path.join(from, e.name);
      const name = renderVars ? render(e.name, renderVars, enabled || {}) : e.name;
      const toAbs = path.join(to, name);
      if (e.isDirectory()) {
        fs.mkdirSync(toAbs, { recursive: true });
        walk(fromAbs, toAbs);
      } else if (e.isFile()) {
        const buf = fs.readFileSync(fromAbs);
        if (!renderVars || buf.includes(0) || !buf.toString('utf8').includes('{{')) {
          fs.writeFileSync(toAbs, buf);
        } else {
          fs.writeFileSync(toAbs, render(buf.toString('utf8'), renderVars, enabled || {}));
        }
      }
    }
  }
  walk(src, dest);
}

module.exports = { listTemplates, loadTemplate, readTemplateJson, copyTree, SKIP_COPY };
