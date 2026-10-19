'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createTempProject } = require('./helpers');

const COMPOSE = [
  '# compose do projeto',
  'services:',
  '  # banco legado',
  '  api:',
  '    image: node:20',
  '',
].join('\n');

describe('infra', () => {
  let t;
  beforeEach(() => {
    t = createTempProject({
      'docker-compose.yaml': COMPOSE,
      'env-example.txt': '# comentario que fica\nJA_EXISTE=1\nDB_HOST=antigo\n',
    });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const api = () => request(t.studio.app);

  it('lista o catalogo', async () => {
    const res = await api().get('/api/projects/teste/infra/catalogo');
    expect(res.status).toBe(200);
    const ids = res.body.catalogo.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['mysql', 'redis', 'rabbitmq', 'mailpit', 'minio', 'meilisearch', 'postgres']));
    expect(JSON.stringify(res.body)).not.toContain('BEGIN PRIVATE');
  });

  it('adiciona mysql no compose sem perder comentario e sem gravar .env', async () => {
    const res = await api().post('/api/projects/teste/infra/servicos').send({ id: 'mysql' });
    expect(res.status).toBe(201);
    expect(res.body.gatewayCriado).toBe(true);
    expect(res.body.blocos).toContain('infra.mysql.query');

    const compose = fs.readFileSync(path.join(t.root, 'docker-compose.yaml'), 'utf8');
    expect(compose).toContain('# compose do projeto');
    expect(compose).toContain('# banco legado');
    expect(compose).toContain('image: node:20');
    expect(compose).toContain('mysql:');
    expect(compose).toContain('mysql:8.4');

    const env = fs.readFileSync(path.join(t.root, 'env-example.txt'), 'utf8');
    expect(env).toContain('# comentario que fica');
    expect(env).toContain('JA_EXISTE=1');
    expect(env).toContain('DB_HOST=antigo');
    expect(env).toContain('DB_PORT=3306');
    expect(env.split('\n').filter((l) => l.startsWith('DB_HOST=')).length).toBe(1);

    const gateway = fs.readFileSync(path.join(t.root, 'infrastructure/gateways/mysql/index.js'), 'utf8');
    expect(gateway).toContain('process.env.DB_HOST');
    expect(gateway).not.toMatch(/password\s*[:=]\s*['"][^'"]+['"]/i);

    expect(fs.readFileSync(path.join(t.root, '.env'), 'utf8')).toBe('SEGREDO=1\n');

    const deNovo = await api().post('/api/projects/teste/infra/servicos').send({ id: 'mysql' });
    expect(deNovo.status).toBe(200);
    expect(deNovo.body.jaExistia).toBe(true);
    expect(deNovo.body.gatewayCriado).toBe(false);
    const compose2 = fs.readFileSync(path.join(t.root, 'docker-compose.yaml'), 'utf8');
    expect(compose2.split('\n').filter((l) => l.trim() === 'mysql:').length).toBe(1);
    const env2 = fs.readFileSync(path.join(t.root, 'env-example.txt'), 'utf8');
    expect(env2.split('\n').filter((l) => l.startsWith('DB_PORT=')).length).toBe(1);
  });

  it('sobe o compose com argumentos em array (sem shell)', async () => {
    const chamadas = [];
    t.studio.deps.ext.infraRunner = async (cmd, args) => {
      chamadas.push({ cmd, args });
      return { code: 0, stdout: 'ok', stderr: '', error: null };
    };
    await api().post('/api/projects/teste/infra/servicos').send({ id: 'redis' });
    const up = await api().post('/api/projects/teste/infra/up').send({ servico: 'redis' });
    expect(up.status).toBe(200);
    expect(up.body.ok).toBe(true);
    expect(chamadas[0].cmd).toBe('docker');
    expect(chamadas[0].args.slice(0, 4)).toEqual(['compose', '-p', 'teste', '-f']);
    expect(chamadas[0].args).toContain('up');
    expect(chamadas[0].args).toContain('-d');
    expect(chamadas[0].args[chamadas[0].args.length - 1]).toBe('redis');
    expect(chamadas[0].args.join(' ')).not.toContain(';');

    const logs = await api().get('/api/projects/teste/infra/logs').query({ tail: '10;rm -rf /', servico: 'redis' });
    expect(logs.status).toBe(200);
    const tailIdx = chamadas[1].args.indexOf('--tail');
    expect(chamadas[1].args[tailIdx + 1]).toBe('10');

    const ruim = await api().post('/api/projects/teste/infra/up').send({ servico: 'redis;rm' });
    expect(ruim.status).toBe(400);
    expect(ruim.body.code).toBe('SERVICO_INVALIDO');
  });

  it('migrate e jest usam npm --prefix no diretorio do projeto', async () => {
    const chamadas = [];
    t.studio.deps.ext.infraRunner = async (cmd, args) => {
      chamadas.push({ cmd, args });
      return { code: 0, stdout: '', stderr: '', error: null };
    };
    const mig = await api().post('/api/projects/teste/infra/migrate');
    const teste = await api().post('/api/projects/teste/infra/test');
    expect(mig.status).toBe(200);
    expect(teste.status).toBe(200);
    expect(chamadas[0]).toEqual({ cmd: 'npm', args: ['--prefix', t.root, 'run', 'migrate'] });
    expect(chamadas[1].cmd).toBe('npm');
    expect(chamadas[1].args).toEqual(['--prefix', t.root, 'exec', '--', 'jest', '--passWithNoTests', '--forceExit']);
  });

  it('healthcheck sem porta no manifesto explica o que falta', async () => {
    const res = await api().get('/api/projects/teste/infra/health');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PORTA_AUSENTE');
  });

  it('docker ausente vira erro claro', async () => {
    fs.writeFileSync(path.join(t.root, 'docker-compose.yaml'), 'services: {}\n');
    t.studio.deps.ext.infraRunner = async () => ({ code: 127, stdout: '', stderr: 'docker nao encontrado', error: 'ENOENT' });
    const res = await api().post('/api/projects/teste/infra/down');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DOCKER_INDISPONIVEL');
  });
});

describe('infra token', () => {
  const anterior = process.env.STUDIO_TOKEN;
  let t;
  beforeEach(() => {
    process.env.STUDIO_TOKEN = 'segredo-teste';
    t = createTempProject();
  });
  afterEach(async () => {
    if (anterior === undefined) delete process.env.STUDIO_TOKEN;
    else process.env.STUDIO_TOKEN = anterior;
    await t.cleanup();
  });

  it('exige o mesmo STUDIO_TOKEN das outras rotas', async () => {
    const sem = await request(t.studio.app).get('/api/projects/teste/infra/catalogo');
    expect(sem.status).toBe(401);
    const com = await request(t.studio.app)
      .get('/api/projects/teste/infra/catalogo')
      .set('Authorization', 'Bearer segredo-teste');
    expect(com.status).toBe(200);
    const camada = await request(t.studio.app).post('/api/projects/teste/layers/entidade').send({ entity: 'X', table: 't', fields: ['id'] });
    expect(camada.status).toBe(401);
  });
});
