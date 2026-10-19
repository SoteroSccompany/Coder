'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const request = require('supertest');
const { createApp } = require('../src/app');

const API_ROOT = path.resolve(__dirname, '../../../api');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function waitHealth(port, child) {
  let errText = '';
  child.stderr.on('data', (buf) => {
    errText += buf.toString();
  });
  const deadline = Date.now() + 8000;
  return (async () => {
    while (Date.now() < deadline) {
      if (child.exitCode != null) throw new Error(`processo encerrou: ${errText}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthcheck`);
        if (res.status === 200) return res.json();
      } catch {
        /* ainda subindo */
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new Error(`timeout no healthcheck: ${errText}`);
  })();
}

describe('projetos', () => {
  let workspace;
  let studio;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ws-'));
    process.env.STUDIO_WORKSPACE = workspace;
    process.env.STUDIO_RECENTS_FILE = path.join(workspace, 'recentes.json');
    process.env.STUDIO_USER_TEMPLATES = path.join(workspace, 'user-templates');
    studio = createApp({ watch: false });
  });

  afterEach(async () => {
    if (studio) await studio.close();
    fs.rmSync(workspace, { recursive: true, force: true });
    delete process.env.STUDIO_WORKSPACE;
    delete process.env.STUDIO_RECENTS_FILE;
    delete process.env.STUDIO_USER_TEMPLATES;
  });

  const http = () => request(studio.app);

  it('GET /api/projects devolve { projects }', async () => {
    const res = await http().get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projects: [] });
  });

  it('sugere porta livre fora de 7900 e 9366', async () => {
    const res = await http().get('/api/ports');
    expect(res.status).toBe(200);
    expect(res.body.reserved).toEqual(expect.arrayContaining([7900, 9366]));
    expect(res.body.port).not.toBe(7900);
    expect(res.body.port).not.toBe(9366);
  });

  it('lista os tres templates', async () => {
    const res = await http().get('/api/templates');
    const ids = res.body.templates.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['api-clean', 'api-minima', 'worker-fila']));
  });

  it('cria api-minima, sobe com node e responde /healthcheck', async () => {
    const res = await http().post('/api/projects').send({ name: 'Demo Minima', template: 'api-minima', services: {} });
    expect(res.status).toBe(201);
    const root = res.body.project.rootPath;
    expect(fs.existsSync(path.join(root, 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, '@core/usecase/Exemplo/indexExemploUseCase.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'studio.project.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'docker-compose.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.studio/blocks'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.env'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'env-example.txt'))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'studio.project.json'), 'utf8'));
    expect(manifest.name).toBe('Demo Minima');
    expect(manifest.runtime).toBe('node');
    expect(manifest.entry).toBe('index.js');
    expect(manifest.blocks).toEqual(expect.arrayContaining(['core', '.studio/blocks']));
    expect(manifest.layers.usecase.editor).toBe('blocks');
    expect(manifest.services.mysql.enabled).toBe(false);

    const compose = fs.readFileSync(path.join(root, 'docker-compose.yaml'), 'utf8');
    expect(compose).not.toMatch(/external:\s*true/);
    expect(compose).toContain('driver: bridge');

    const port = await freePort();
    const child = spawn(process.execPath, ['index.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), NODE_PATH: path.resolve(__dirname, '../node_modules') },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    try {
      const body = await waitHealth(port, child);
      expect(body.status).toBe('ok');
      expect(body.exemplo.status).toBe(true);
    } finally {
      child.kill('SIGKILL');
    }

    const tree = await http().get(`/api/projects/${res.body.project.id}/tree`);
    expect(tree.status).toBe(200);
    expect(JSON.stringify(tree.body)).not.toContain('.env');
    const recentes = await http().get('/api/recentes');
    expect(recentes.body.recentes.map((r) => r.rootPath)).toContain(root);
  });

  it('cria api-clean com pastas, Dockerfile e compose com mysql', async () => {
    const res = await http().post('/api/projects').send({ name: 'API Limpa', template: 'api-clean' });
    expect(res.status).toBe(201);
    const root = res.body.project.rootPath;
    for (const rel of [
      '@core/domain',
      '@core/usecase',
      'infrastructure/db/services',
      'infrastructure/Controllers',
      'infrastructure/routes/index.js',
      'infrastructure/queue/workers',
      'infrastructure/gateways',
      'knex/migrations',
      'knexfile.js',
      'Dockerfile',
      'package.json',
      'env-example.txt',
    ]) {
      expect(fs.existsSync(path.join(root, rel))).toBe(true);
    }
    const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    expect(docker).toContain('node:20-slim');
    expect(docker).toContain('nodemon');
    expect(fs.readFileSync(path.join(root, 'infrastructure/routes/index.js'), 'utf8')).toContain('/healthcheck');
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yaml'), 'utf8');
    expect(compose).toContain('mysql:');
    expect(compose).not.toMatch(/external:\s*true/);
    const example = fs.readFileSync(path.join(root, 'env-example.txt'), 'utf8');
    expect(example).not.toContain('devapp');
    expect(example).toContain('DB_PASS=');
  });

  it('cria worker-fila com consumidor e rabbitmq no compose', async () => {
    const res = await http().post('/api/projects').send({ name: 'Fila', template: 'worker-fila' });
    expect(res.status).toBe(201);
    const root = res.body.project.rootPath;
    const worker = fs.readFileSync(path.join(root, 'infrastructure/queue/workers/consumidor.js'), 'utf8');
    expect(worker).toContain('assertQueue');
    expect(worker).toContain('consume');
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yaml'), 'utf8');
    expect(compose).toContain('rabbitmq:');
    expect(compose).not.toMatch(/external:\s*true/);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'studio.project.json'), 'utf8'));
    expect(manifest.services.rabbitmq.enabled).toBe(true);
    expect(manifest.layers.worker.path).toBe('infrastructure/queue/workers');
  });

  it('import dry-run do api/ real detecta camadas e nao grava manifesto', async () => {
    const manifestPath = path.join(API_ROOT, 'studio.project.json');
    const existed = fs.existsSync(manifestPath);
    const before = existed ? fs.statSync(manifestPath).mtimeMs : null;

    const res = await http().post('/api/projects/import-preview').send({ path: API_ROOT });
    expect(res.status).toBe(200);
    expect(res.body.wrote).toBe(false);
    expect(res.body.hasManifest).toBe(false);

    const byId = Object.fromEntries(res.body.layers.map((l) => [l.id, l]));
    expect(byId.domain).toMatchObject({ path: '@core/domain', editor: 'domain-form' });
    expect(byId.usecase).toMatchObject({ path: '@core/usecase/{Entity}', editor: 'blocks' });
    expect(byId.repository.path).toBe('infrastructure/db/services');
    expect(byId.controller.path).toBe('infrastructure/Controllers');
    expect(byId.routes.path).toBe('infrastructure/routes');
    expect(byId.worker.path).toBe('infrastructure/queue/workers');
    expect(byId.gateway.path).toBe('infrastructure/gateways');
    expect(byId.migration.path).toBe('knex/migrations');
    expect(byId.domain.file).toBe('{Entity}.js');
    expect(byId.usecase.file).toBe('{action}{Entity}UseCase.js');

    const unmapped = res.body.unmapped.map((l) => l.path);
    expect(unmapped).toEqual(expect.arrayContaining(['certs', 'plugin', 'Logs/exeptions']));
    for (const layer of res.body.unmapped) expect(layer.editor).toBe('monaco');

    expect(fs.existsSync(manifestPath)).toBe(existed);
    if (before != null) expect(fs.statSync(manifestPath).mtimeMs).toBe(before);
  });

  it('import confirmado grava o manifesto so na copia, nunca no api/', async () => {
    const apiManifest = path.join(API_ROOT, 'studio.project.json');
    const existed = fs.existsSync(apiManifest);

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-import-'));
    const dirs = [
      '@core/domain',
      '@core/usecase',
      'infrastructure/Controllers',
      'infrastructure/db/services',
      'infrastructure/routes',
      'infrastructure/queue/workers',
      'infrastructure/gateways',
      'knex/migrations',
      'certs',
      'plugin',
      'Logs/exeptions',
    ];
    for (const rel of dirs) fs.mkdirSync(path.join(fixture, rel), { recursive: true });
    const before = fs.readdirSync(fixture);

    try {
      const preview = await http().post('/api/projects/import-preview').send({ path: fixture });
      expect(preview.body.wrote).toBe(false);
      expect(fs.existsSync(path.join(fixture, 'studio.project.json'))).toBe(false);

      const res = await http().post('/api/projects/import').send({ path: fixture, confirm: true });
      expect(res.status).toBe(200);
      expect(res.body.wrote).toBe(true);
      const written = fs.readdirSync(fixture).filter((name) => !before.includes(name));
      expect(written).toEqual(['studio.project.json']);
      const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'studio.project.json'), 'utf8'));
      expect(manifest.layers.domain.path).toBe('@core/domain');
      expect(manifest.layers.certs.editor).toBe('monaco');
      expect(manifest.layers['logs-exeptions'].path).toBe('Logs/exeptions');
      expect(manifest.layers['logs-exeptions'].editor).toBe('monaco');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }

    expect(fs.existsSync(apiManifest)).toBe(existed);
  });

  it('clona, arquiva e salva como template do usuario', async () => {
    const created = await http().post('/api/projects').send({ name: 'Origem', template: 'api-minima', services: {} });
    const id = created.body.project.id;
    const origem = created.body.project.rootPath;

    const clone = await http().post(`/api/projects/${id}/clone`).send({ name: 'Origem copia' });
    expect(clone.status).toBe(201);
    expect(clone.body.project.rootPath).not.toBe(origem);
    expect(fs.existsSync(path.join(clone.body.project.rootPath, 'index.js'))).toBe(true);
    const copiaManifest = JSON.parse(fs.readFileSync(path.join(clone.body.project.rootPath, 'studio.project.json'), 'utf8'));
    expect(copiaManifest.name).toBe('Origem copia');
    expect(fs.existsSync(path.join(origem, 'index.js'))).toBe(true);

    const saved = await http().post(`/api/projects/${id}/save-template`).send({ name: 'meu-template', destination: 'user' });
    expect(saved.status).toBe(201);
    expect(fs.existsSync(path.join(saved.body.dir, 'template.json'))).toBe(true);
    expect(fs.existsSync(path.join(saved.body.dir, 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(saved.body.dir, '.env'))).toBe(false);
    expect(saved.body.dir.startsWith(path.join(workspace, 'user-templates'))).toBe(true);

    const archived = await http().post(`/api/projects/${id}/archive`);
    expect(archived.body.archived).toBe(true);
    expect(fs.existsSync(origem)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(origem, 'studio.project.json'), 'utf8'));
    expect(manifest.archived).toBe(true);
    const list = await http().get('/api/projects');
    expect(list.body.projects.map((p) => p.rootPath)).not.toContain(origem);
    const rec = await http().get('/api/recentes');
    expect(rec.body.archived.map((r) => r.rootPath)).toContain(origem);
  });
});
