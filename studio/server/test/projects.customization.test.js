'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createTempProject } = require('./helpers');

describe('personalizacao do projeto', () => {
  let t;

  beforeEach(() => {
    process.env.STUDIO_RECENTS_FILE = path.join(os.tmpdir(), `studio-recentes-${process.pid}.json`);
    t = createTempProject(
      {
        'infrastructure/db/services/FooRepository.js':
          "const db = require('../config/databaseConection');\nmodule.exports = db;\n",
        'infrastructure/db/config/databaseConection.js': 'module.exports = {};\n',
        '@core/usecase/Foo/createFooUseCase.js':
          "const repo = require('../../../infrastructure/db/services/FooRepository');\nmodule.exports = repo;\n",
        'env-example.txt': 'PORT=4000\nDB_PASS=\n',
      },
      {
        manifest: {
          name: 'Temp',
          runtime: 'node',
          entry: 'index.js',
          port: 4000,
          layers: {
            repository: { path: 'infrastructure/db/services', editor: 'text', file: '{Entity}Repository.js' },
          },
          naming: { table: 'tab_{snake}' },
          fileTemplates: { usecase: 'class X {}\n' },
          services: { mysql: { enabled: false, port: 3306 } },
          blocks: ['core', '.studio/blocks'],
          ignore: ['.env'],
        },
      },
    );
  });

  afterEach(async () => {
    await t.cleanup();
    delete process.env.STUDIO_RECENTS_FILE;
  });

  const http = () => request(t.studio.app);
  const usecase = () => path.join(t.root, '@core/usecase/Foo/createFooUseCase.js');
  const repo = () => path.join(t.root, 'infrastructure/db/services/FooRepository.js');

  it('atualiza naming e fileTemplates sem mover pastas', async () => {
    const before = fs.readFileSync(usecase(), 'utf8');
    const res = await http().put('/api/projects/teste/manifest').send({
      naming: { table: 'tab_{snake}', entity: '{Entity}' },
      fileTemplates: { usecase: 'class Novo {}\n' },
    });
    expect(res.status).toBe(200);
    expect(res.body.manifest.naming.entity).toBe('{Entity}');
    expect(res.body.manifest.fileTemplates.usecase).toBe('class Novo {}\n');
    expect(fs.readFileSync(usecase(), 'utf8')).toBe(before);
  });

  it('recusa trocar o path da camada pelo PUT do manifesto', async () => {
    const res = await http().put('/api/projects/teste/manifest').send({
      layers: { repository: { path: 'dados/repositorios', editor: 'text' } },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('USE_LAYER_MOVE');
    expect(fs.existsSync(repo())).toBe(true);
  });

  it('le e grava env-example.txt e continua ocultando o .env', async () => {
    const read = await http().get('/api/projects/teste/env-example');
    expect(read.status).toBe(200);
    expect(read.body.content).toContain('PORT=4000');
    expect(read.body.content).not.toContain('SEGREDO');

    const saved = await http().put('/api/projects/teste/env-example').send({
      content: 'PORT=4001\nDB_PASS=\n',
      baseHash: read.body.hash,
    });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(t.root, 'env-example.txt'), 'utf8')).toBe('PORT=4001\nDB_PASS=\n');
    expect(fs.readFileSync(path.join(t.root, '.env'), 'utf8')).toBe('SEGREDO=1\n');

    const secret = await http().get('/api/projects/teste/file').query({ path: '.env' });
    expect(secret.status).toBe(403);
    expect(secret.body.code).toBe('PATH_IGNORED');
  });

  it('dry-run de renomear camada mostra o require novo e nao grava', async () => {
    const beforeUse = fs.readFileSync(usecase(), 'utf8');
    const beforeRepo = fs.readFileSync(repo(), 'utf8');
    const mtime = fs.statSync(usecase()).mtimeMs;

    const res = await http().post('/api/projects/teste/layers/rename').send({
      layerId: 'repository',
      path: 'dados/repositorios',
      dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.wrote).toBe(false);
    expect(res.body.directoryMove).toEqual({ from: 'infrastructure/db/services', to: 'dados/repositorios' });
    const blob = JSON.stringify(res.body.changes);
    expect(blob).toContain('../../../dados/repositorios/FooRepository');
    expect(blob).toContain('../../infrastructure/db/config/databaseConection');
    expect(fs.readFileSync(usecase(), 'utf8')).toBe(beforeUse);
    expect(fs.readFileSync(repo(), 'utf8')).toBe(beforeRepo);
    expect(fs.statSync(usecase()).mtimeMs).toBe(mtime);
    expect(fs.existsSync(path.join(t.root, 'dados/repositorios'))).toBe(false);
  });

  it('apply move a pasta, atualiza require e o manifesto', async () => {
    const res = await http().post('/api/projects/teste/layers/rename').send({
      layerId: 'repository',
      path: 'dados/repositorios',
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(fs.existsSync(repo())).toBe(false);
    const moved = path.join(t.root, 'dados/repositorios/FooRepository.js');
    expect(fs.readFileSync(moved, 'utf8')).toMatch(/require\((['"])\.\.\/\.\.\/infrastructure\/db\/config\/databaseConection\1\)/);
    expect(fs.readFileSync(usecase(), 'utf8')).toMatch(/require\((['"])\.\.\/\.\.\/\.\.\/dados\/repositorios\/FooRepository\1\)/);
    const manifest = JSON.parse(fs.readFileSync(path.join(t.root, 'studio.project.json'), 'utf8'));
    expect(manifest.layers.repository.path).toBe('dados/repositorios');
  });

  it('desfaz a movimentacao se a pasta de destino nao puder ser criada', async () => {
    fs.writeFileSync(path.join(t.root, 'dados'), 'nao-e-pasta');
    const before = fs.readFileSync(usecase(), 'utf8');
    const res = await http().post('/api/projects/teste/layers/rename').send({
      layerId: 'repository',
      path: 'dados/repositorios',
      confirm: true,
    });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('LAYER_MOVE_FAILED');
    expect(fs.readFileSync(usecase(), 'utf8')).toBe(before);
    expect(fs.existsSync(repo())).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(t.root, 'studio.project.json'), 'utf8'));
    expect(manifest.layers.repository.path).toBe('infrastructure/db/services');
  });
});
