'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createTempProject } = require('./helpers');

describe('API de arquivos', () => {
  let t;
  beforeEach(() => {
    t = createTempProject();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const get = (p) => request(t.studio.app).get('/api/projects/teste/file').query({ path: p });
  const put = (p, body) => request(t.studio.app).put('/api/projects/teste/file').query({ path: p }).send(body);

  it('GET /api/health', async () => {
    const res = await request(t.studio.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('lista projetos abertos', async () => {
    const res = await request(t.studio.app).get('/api/projects');
    expect(res.body.projects.map((p) => p.id)).toEqual(['teste']);
  });

  describe('arvore', () => {
    it('agrupa por layer e respeita ignore', async () => {
      const res = await request(t.studio.app).get('/api/projects/teste/tree');
      expect(res.status).toBe(200);
      const byId = Object.fromEntries(res.body.layers.map((l) => [l.id, l]));
      expect(byId.domain.exists).toBe(true);
      expect(byId.domain.children.map((n) => n.path)).toEqual(['@core/domain/Foo.js']);
      expect(byId.usecase.children[0].children[0].path).toBe('@core/usecase/Foo/createFooUseCase.js');
      expect(byId.worker.exists).toBe(false);

      const flat = JSON.stringify(res.body);
      expect(flat).not.toContain('.env');
      expect(flat).not.toContain('security');
      expect(flat).not.toContain('Logs');
      expect(flat).not.toContain('node_modules');
      // "other" nao repete arquivos de layers e contem o resto
      const otherPaths = res.body.other.map((n) => n.path);
      expect(otherPaths).toContain('index.js');
      expect(otherPaths).not.toContain('@core');
    });

    it('404 para projeto desconhecido', async () => {
      const res = await request(t.studio.app).get('/api/projects/nao-existe/tree');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PROJECT_NOT_FOUND');
    });
  });

  describe('ignore', () => {
    it.each(['.env', 'security/chave.pem', 'Logs/a.log', 'node_modules/x/index.js'])('bloqueia leitura de %s', async (p) => {
      const res = await get(p);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PATH_IGNORED');
    });

    it('bloqueia escrita em .env e security', async () => {
      expect((await put('.env', { content: 'X=1', baseHash: null })).status).toBe(403);
      expect((await put('security/novo.pem', { content: 'X', baseHash: null })).status).toBe(403);
      expect(fs.readFileSync(path.join(t.root, '.env'), 'utf8')).toBe('SEGREDO=1\n');
    });

    it('manifesto pode acrescentar ignores (sem remover os padroes)', async () => {
      const t2 = createTempProject({ 'segredos/a.txt': 'x', 'cert.pem': 'y' }, { manifest: { ignore: ['segredos', '*.pem'] } });
      try {
        const r = (p) => request(t2.studio.app).get('/api/projects/teste/file').query({ path: p });
        expect((await r('segredos/a.txt')).status).toBe(403);
        expect((await r('cert.pem')).status).toBe(403);
        expect((await r('.env')).status).toBe(403);
        expect((await r('index.js')).status).toBe(200);
      } finally {
        await t2.cleanup();
      }
    });
  });

  describe('path traversal', () => {
    it.each(['../package.json', '../../etc/passwd', '@core/../../x', '/etc/passwd', 'a/../../b', '..\\..\\x'])(
      'bloqueia GET %s',
      async (p) => {
        const res = await get(p);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PATH_TRAVERSAL');
      },
    );

    it('bloqueia %2e%2e codificado', async () => {
      const res = await request(t.studio.app).get('/api/projects/teste/file?path=%2e%2e%2fpackage.json');
      expect(res.status).toBe(403);
    });

    it('bloqueia escrita fora do projeto', async () => {
      const outside = path.join(path.dirname(t.root), 'fora-do-projeto.txt');
      const res = await put('../fora-do-projeto.txt', { content: 'x', baseHash: null });
      expect(res.status).toBe(403);
      expect(fs.existsSync(outside)).toBe(false);
    });

    it('bloqueia byte nulo e path ausente', async () => {
      expect((await get('index.js\0.png')).status).toBe(400);
      expect((await request(t.studio.app).get('/api/projects/teste/file')).status).toBe(400);
    });

    it('bloqueia symlink que escapa do projeto', async () => {
      const outsideDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'studio-out-'));
      fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'segredo');
      fs.symlinkSync(outsideDir, path.join(t.root, 'link'));
      try {
        const res = await get('link/secret.txt');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PATH_TRAVERSAL');
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('leitura/escrita e conflito 409', () => {
    it('le arquivo com hash e layer', async () => {
      const res = await get('@core/domain/Foo.js');
      expect(res.status).toBe(200);
      expect(res.body.content).toContain('class Foo');
      expect(res.body.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.layer).toBe('domain');
    });

    it('404 em arquivo inexistente', async () => {
      expect((await get('nao/existe.js')).status).toBe(404);
    });

    it('PUT exige baseHash', async () => {
      const res = await put('index.js', { content: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BASE_HASH_REQUIRED');
    });

    it('salva com baseHash correto e devolve novo hash', async () => {
      const r = (await get('index.js')).body;
      const res = await put('index.js', { content: 'console.log(2);\n', baseHash: r.hash });
      expect(res.status).toBe(200);
      expect(fs.readFileSync(path.join(t.root, 'index.js'), 'utf8')).toBe('console.log(2);\n');
      expect((await get('index.js')).body.hash).toBe(res.body.hash);
    });

    it('409 quando o arquivo mudou no disco depois da leitura', async () => {
      const r = (await get('index.js')).body;
      fs.writeFileSync(path.join(t.root, 'index.js'), 'console.log("externo");\n');
      const res = await put('index.js', { content: 'console.log("meu");\n', baseHash: r.hash });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.currentContent).toBe('console.log("externo");\n');
      expect(res.body.baseHash).toBe(r.hash);
      // nada foi sobrescrito
      expect(fs.readFileSync(path.join(t.root, 'index.js'), 'utf8')).toBe('console.log("externo");\n');
    });

    it('cria arquivo novo com baseHash null (e 409 se ja existir)', async () => {
      const ok = await put('novo/dir/a.js', { content: 'a', baseHash: null });
      expect(ok.status).toBe(200);
      expect(ok.body.created).toBe(true);
      const again = await put('novo/dir/a.js', { content: 'b', baseHash: null });
      expect(again.status).toBe(409);
    });

    it('409 ao salvar arquivo que foi removido', async () => {
      const r = (await get('index.js')).body;
      fs.unlinkSync(path.join(t.root, 'index.js'));
      const res = await put('index.js', { content: 'x', baseHash: r.hash });
      expect(res.status).toBe(409);
    });

    it('so um de dois salvamentos concorrentes com o mesmo baseHash vence', async () => {
      const r = (await get('index.js')).body;
      const [a, b] = await Promise.all([
        put('index.js', { content: 'A\n', baseHash: r.hash }),
        put('index.js', { content: 'B\n', baseHash: r.hash }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it('rejeita arquivo binario', async () => {
      fs.writeFileSync(path.join(t.root, 'bin.dat'), Buffer.from([1, 0, 2]));
      expect((await get('bin.dat')).status).toBe(415);
    });
  });
});

describe('token opcional', () => {
  it('exige token quando STUDIO_TOKEN esta definido (exceto /api/health)', async () => {
    const { createApp } = require('../src/app');
    const studio = createApp({ token: 's3cr3t', watch: false });
    try {
      expect((await request(studio.app).get('/api/health')).status).toBe(200);
      expect((await request(studio.app).get('/api/projects')).status).toBe(401);
      expect((await request(studio.app).get('/api/projects').set('Authorization', 'Bearer errado')).status).toBe(401);
      expect((await request(studio.app).get('/api/projects').set('Authorization', 'Bearer s3cr3t')).status).toBe(200);
    } finally {
      await studio.close();
    }
  });
});
