'use strict';

/**
 * Caminhos do workspace, templates e recentes.
 * Lidos na hora da chamada (os testes trocam o env entre casos).
 */

const fs = require('fs');
const path = require('path');
const { HttpError } = require('../util/httpError');

/** Raiz do repositorio Coder (studio/server/src/projects -> 4 niveis acima). */
function repoRoot() {
  return path.resolve(__dirname, '../../../..');
}

function workspaceRoot() {
  const fromEnv = process.env.STUDIO_WORKSPACE;
  return path.resolve(fromEnv || repoRoot());
}

function projectsDir() {
  return path.join(workspaceRoot(), 'projects');
}

function studioTemplatesDir() {
  return path.resolve(process.env.STUDIO_TEMPLATES_DIR || path.join(repoRoot(), 'studio', 'templates'));
}

function userTemplatesDir() {
  if (process.env.STUDIO_USER_TEMPLATES) return path.resolve(process.env.STUDIO_USER_TEMPLATES);
  return path.join(workspaceRoot(), '.studio', 'templates');
}

function recentesFile() {
  if (process.env.STUDIO_RECENTS_FILE) return path.resolve(process.env.STUDIO_RECENTS_FILE);
  return path.join(__dirname, '../../data/recentes.json');
}

function slugify(name) {
  const s = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'projeto';
}

function assertSafeSlug(slug) {
  if (!/^[a-z0-9][a-z0-9_-]{0,48}$/.test(slug)) {
    throw HttpError.badRequest('NAME_INVALID', 'Use letras, numeros, hifen ou underscore (comece com letra ou numero)');
  }
  return slug;
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

/**
 * Resolve um caminho informado pelo usuario.
 * Relativo e interpretado a partir do workspace (ex.: "api" -> <workspace>/api).
 */
function resolveUserPath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw HttpError.badRequest('PATH_REQUIRED', 'Informe o caminho da pasta');
  }
  const trimmed = input.trim();
  return path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(workspaceRoot(), trimmed));
}

function assertExistingDir(abs) {
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw HttpError.notFound('PROJECT_PATH_NOT_FOUND', `Pasta nao encontrada: ${abs}`);
  }
  if (!stat.isDirectory()) {
    throw HttpError.badRequest('PROJECT_PATH_NOT_DIR', `Nao e uma pasta: ${abs}`);
  }
  return fs.realpathSync(abs);
}

function uniqueDest(dir, slug) {
  let name = slug;
  let n = 2;
  while (fs.existsSync(path.join(dir, name))) name = `${slug}-${n++}`;
  return path.join(dir, name);
}

module.exports = {
  repoRoot,
  workspaceRoot,
  projectsDir,
  studioTemplatesDir,
  userTemplatesDir,
  recentesFile,
  slugify,
  assertSafeSlug,
  writeAtomic,
  resolveUserPath,
  assertExistingDir,
  uniqueDest,
};
