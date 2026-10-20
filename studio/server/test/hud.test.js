'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const request = require('supertest');
const { createTempProject } = require('./helpers');

const CAIXA = [
  'class Caixa {',
  '  async run(data) {',
  '    const user = data.id;',
  '    return user;',
  '  }',
  '}',
  'module.exports = Caixa;',
  '',
].join('\n');

const VOO = [
  'class Caixa {',
  '  async run(data) {',
  '    const a = data.n;',
  '    const b = a + 1;',
  '    return b;',
  '  }',
  '}',
  'module.exports = Caixa;',
  '',
].join('\n');

const VOO_ERRO = [
  'class Caixa {',
  '  async run(data) {',
  '    const a = data.n;',
  '    throw new Error("quebrou");',
  '  }',
  '}',
  'module.exports = Caixa;',
  '',
].join('\n');

function portaLivre() {
  return new Promise((resolve, reject) => {
    const servidor = net.createServer();
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      const porta = servidor.address().port;
      servidor.close((err) => (err ? reject(err) : resolve(porta)));
    });
  });
}

function api(t) {
  return request(t.studio.app);
}

describe('hud do servidor', () => {
  let t;

  beforeEach(() => {
    t = createTempProject({
      '@core/usecase/Caixa/caixa.js': CAIXA,
    });
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('devolve loc no fluxo e o round-trip do arquivo continua igual', async () => {
    const rel = '@core/usecase/Caixa/caixa.js';
    const abs = path.join(t.root, rel);
    const antes = fs.readFileSync(abs, 'utf8');
    const got = await api(t).get('/api/projects/teste/blocks/flow').query({ path: rel });
    expect(got.status).toBe(200);
    const metodo = got.body.methods.find((m) => m.name === 'run');
    expect(metodo.blocks.map((b) => b.loc && b.loc.start.line)).toEqual([3, 4]);
    expect(metodo.blocks[0].loc).toEqual({
      start: { line: 3, column: 4 },
      end: { line: 3, column: expect.any(Number) },
    });
    expect(metodo.blocks[1].loc.start).toEqual({ line: 4, column: 4 });

    const put = await api(t).put('/api/projects/teste/blocks/flow').query({ path: rel }).send({
      baseHash: got.body.hash,
      method: 'run',
      className: metodo.className,
      blocks: metodo.blocks,
    });
    expect(put.status).toBe(200);
    expect(put.body.unchanged).toBe(true);
    expect(fs.readFileSync(abs, 'utf8')).toBe(antes);
  });

  it('contexto extrai const', async () => {
    const res = await api(t).post('/api/projects/teste/blocks/contexto').send({
      params: 'data, trx',
      index: 1,
      blocks: [
        { id: 'livre.codigo-livre', slots: { codigo: 'const user = data.id;' }, children: {} },
        { id: 'livre.codigo-livre', slots: { codigo: 'return user;' }, children: {} },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.params).toEqual(['data', 'trx']);
    expect(res.body.declarados).toEqual(['user']);
    expect(res.body.le).toEqual(['user']);
    expect(res.body.produz).toEqual([]);

    const produz = await api(t).post('/api/projects/teste/blocks/contexto').send({
      params: 'data',
      index: 0,
      blocks: [{
        id: 'dados.buscar-usuario',
        slots: { variavel: 'user', argumentos: 'data.id' },
        children: {},
      }],
    });
    expect(produz.status).toBe(200);
    expect(produz.body.declarados).toEqual([]);
    expect(produz.body.produz).toContain('user');
    expect(produz.body.le).toEqual(expect.arrayContaining(['data']));
  });

  it('jarvis "devolve ok" gera placa de retorno', async () => {
    const res = await api(t).post('/api/projects/teste/blocks/jarvis').send({
      frase: 'devolve ok',
      index: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.posicao).toBe(2);
    expect(res.body.placas).toHaveLength(1);
    expect(res.body.placas[0].id).toBe('fluxo.retornar-status');
    expect(res.body.placas[0].slots.status).toBe('true');
    expect(res.body.placas[0].slots.msg).toBe('"ok"');
    expect(res.body.fala.toLowerCase()).toContain('ok');

    const livre = await api(t).post('/api/projects/teste/blocks/jarvis').send({
      frase: 'xyz sem mapa',
      index: -1,
    });
    expect(livre.status).toBe(200);
    expect(livre.body.posicao).toBe(-1);
    expect(livre.body.placas[0].id).toBe('livre.codigo-livre');
    expect(livre.body.placas[0].slots.codigo).toBe('xyz sem mapa');
  });

  it('testar cruza a linha do stack com a placa', async () => {
    const rel = '@core/usecase/Caixa/caixa.js';
    const abs = path.join(t.root, rel);
    const chamadas = [];
    t.studio.deps.ext.runRunner = async (cmd, args) => {
      chamadas.push({ cmd, args });
      return {
        code: 1,
        stdout: '',
        stderr: [
          'Error: falhou',
          `    at Caixa.run (${abs}:3:11)`,
          '    at Runtime.fn (/tmp/node_modules/jest-runtime/index.js:1:1)',
        ].join('\n'),
        error: null,
      };
    };
    const res = await api(t).post('/api/projects/teste/run/testar').send({});
    expect(res.status).toBe(200);
    expect(chamadas[0].cmd).toBe('npx');
    expect(chamadas[0].args[0]).toBe('jest');
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe(1);
    expect(res.body.placa).toEqual({ line: 3, index: 0 });

    const comPath = await api(t).post('/api/projects/teste/run/testar').send({ path: rel });
    expect(comPath.body.placa).toEqual({ line: 3, index: 0 });
  });
});

describe('voo', () => {
  it('acende os indices em ordem e nao escreve no arquivo', async () => {
    const rel = '@core/usecase/Caixa/caixa.js';
    const t = createTempProject({ [rel]: VOO });
    const abs = path.join(t.root, rel);
    const antes = fs.readFileSync(abs);
    const mtime = fs.statSync(abs).mtimeMs;
    const traces = [];
    t.studio.deps.hub.on('publish', (msg) => {
      if (msg.type === 'run:trace') traces.push(msg.payload);
    });
    try {
      const res = await api(t).post('/api/projects/teste/run/voo').send({
        path: rel,
        method: 'run',
        className: 'Caixa',
        input: { n: 2 },
      });
      expect(res.status).toBe(200);
      expect(res.body.passos.map((p) => p.index)).toEqual([0, 1, 2]);
      expect(res.body.passos.every((p) => p.ok === true)).toBe(true);
      expect(res.body.passos.every((p) => Number.isInteger(p.ms) && p.ms >= 0)).toBe(true);
      expect(traces.map((p) => p.index)).toEqual([0, 1, 2]);
      expect(fs.readFileSync(abs).equals(antes)).toBe(true);
      expect(fs.statSync(abs).mtimeMs).toBe(mtime);
    } finally {
      await t.cleanup();
    }
  });

  it('marca a placa que estourou e preserva o arquivo', async () => {
    const rel = '@core/usecase/Caixa/caixa.js';
    const t = createTempProject({ [rel]: VOO_ERRO });
    const abs = path.join(t.root, rel);
    const antes = fs.readFileSync(abs, 'utf8');
    try {
      const res = await api(t).post('/api/projects/teste/run/voo').send({
        path: rel,
        method: 'run',
        input: { n: 1 },
      });
      expect(res.status).toBe(200);
      expect(res.body.passos.map((p) => p.index)).toEqual([0, 1]);
      expect(res.body.passos[0].ok).toBe(true);
      expect(res.body.passos[1].ok).toBe(false);
      expect(res.body.passos[1].error).toMatch(/quebrou/);
      expect(fs.readFileSync(abs, 'utf8')).toBe(antes);
    } finally {
      await t.cleanup();
    }
  });
});

describe('ligar e desligar', () => {
  it('sobe o index.js na porta do projeto e encerra', async () => {
    const porta = await portaLivre();
    const t = createTempProject({
      'index.js': [
        "const http = require('http');",
        'const servidor = http.createServer((req, res) => {',
        "  res.writeHead(200, { 'content-type': 'text/plain' });",
        "  res.end('vivo');",
        '});',
        "servidor.listen(Number(process.env.PORT), '127.0.0.1');",
        "console.log('armadura-ligada');",
        '',
      ].join('\n'),
    }, { manifest: { port: porta, name: 'armadura' } });
    const logs = [];
    t.studio.deps.hub.on('publish', (msg) => {
      if (msg.type === 'run:log') logs.push(msg.payload);
    });
    try {
      const ligou = await api(t).post('/api/projects/teste/run/ligar');
      expect(ligou.status).toBe(200);
      expect(ligou.body).toMatchObject({
        ok: true,
        porta,
        url: `http://127.0.0.1:${porta}`,
      });
      expect(ligou.body.pid).toEqual(expect.any(Number));
      expect(logs.some((l) => l.stream === 'stdout' && String(l.line).includes('armadura-ligada'))).toBe(true);

      const deNovo = await api(t).post('/api/projects/teste/run/ligar');
      expect(deNovo.body.pid).toBe(ligou.body.pid);

      const acao = await api(t).post('/api/projects/teste/run/acionar').send({
        method: 'GET',
        path: '/',
      });
      expect(acao.status).toBe(200);
      expect(acao.body.status).toBe(200);
      expect(acao.body.body).toBe('vivo');
      expect(typeof acao.body.ms).toBe('number');

      const desligou = await api(t).post('/api/projects/teste/run/desligar');
      expect(desligou.status).toBe(200);
      expect(desligou.body.ok).toBe(true);

      const parado = await api(t).post('/api/projects/teste/run/acionar').send({ method: 'GET', path: '/' });
      expect(parado.status).toBe(409);
    } finally {
      await api(t).post('/api/projects/teste/run/desligar');
      await t.cleanup();
    }
  });
});
