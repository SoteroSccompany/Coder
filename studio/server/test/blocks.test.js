'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createTempProject } = require('./helpers');
const { createBlockService } = require('../src/blocks/service');
const ast = require('../src/services/astService');

const svc = createBlockService({ ast, files: null, config: {} });
const EXEMPLO = path.resolve(__dirname, '../../../api/@core/usecase/DesafioAutenticacao/createDesafioAutenticacaoUseCase.js');

function idsOf(nodes, acc = []) {
  for (const n of nodes || []) {
    acc.push(n.id);
    for (const kids of Object.values(n.children || {})) idsOf(kids, acc);
  }
  return acc;
}

describe('motor de blocos', () => {
  it('reconhece os trechos estaveis do use case de exemplo', () => {
    const source = fs.readFileSync(EXEMPLO, 'utf8');
    const flow = svc.decompose(source, null);
    const index = flow.methods.find((m) => m.name === 'indexDesafioAutenticacao');
    const ids = idsOf(index.blocks);
    expect(ids).toEqual(expect.arrayContaining([
      'fluxo.try-catch-log',
      'fluxo.guard-status',
      'fluxo.se-senao',
      'fluxo.retornar-status',
      'dados.buscar-usuario',
      'dados.chamar-repositorio',
      'dados.instanciar-domain',
      'dados.transacao-knex',
      'dados.gravar-auditoria',
      'seguranca.sha',
      'seguranca.otp-qrcode',
    ]));
    const confirm = flow.methods.find((m) => m.name === 'ConfirmacaoDesafioAutenticacao');
    expect(idsOf(confirm.blocks)).toContain('seguranca.bcrypt');
  });

  it('deixa de proposito como codigo livre o if que nao e guard de status e o return com campos extras', () => {
    const source = fs.readFileSync(EXEMPLO, 'utf8');
    const flow = svc.decompose(source, null);
    const index = flow.methods.find((m) => m.name === 'indexDesafioAutenticacao');
    const livres = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.id === 'livre.codigo-livre') livres.push(n.slots.codigo);
        for (const kids of Object.values(n.children || {})) walk(kids);
      }
    };
    walk(index.blocks);
    expect(livres.some((c) => c.includes('dois_fatores'))).toBe(true);
    expect(livres.some((c) => c.includes('qrcode'))).toBe(true);
  });

  it('fluxo guard + retorno gera JS valido e preserva o require existente', () => {
    const src = [
      "const repository = require('../../../infrastructure/db/services/FooRepository');",
      'class FooUseCase {',
      '    async run(data) {',
      '        return null;',
      '    }',
      '}',
      'module.exports = FooUseCase;',
      '',
    ].join('\n');
    const out = svc.apply(src, {
      method: 'run',
      blocks: [
        { id: 'fluxo.guard-status', slots: { alvo: 'data', msg: '"negado"' }, children: {} },
        { id: 'fluxo.retornar-status', slots: { status: 'true', msg: '"ok"' }, children: {} },
      ],
    }, null);
    expect(() => ast.parseFile(out)).not.toThrow();
    expect(out).toContain("const repository = require('../../../infrastructure/db/services/FooRepository');");
    expect(out.match(/require\(/g)).toHaveLength(1);
    expect(out).toContain('if (!data.status) return { status: false, msg: "negado" }');
    expect(out).toContain('return { status: true, msg: "ok" };');
    expect(out).toContain('class FooUseCase');
    expect(out).toContain('module.exports = FooUseCase;');
  });

  it('adiciona o require do bloco ao entrar e remove ao sair', () => {
    const vazio = 'class A {\n  async run(data) {\n    return 1;\n  }\n}\nmodule.exports = A;\n';
    const com = svc.apply(vazio, {
      method: 'run',
      blocks: [{
        id: 'dados.buscar-usuario',
        variant: 'const-await',
        geracao: 'chamada',
        slots: { variavel: 'checkUser', alvo: 'GetUserUsecase', metodo: 'getById', argumentos: '{ id: data.id }' },
        children: {},
      }],
    }, null);
    expect(com).toContain('const GetUserUsecase = require("../Usuario/getUsuario");');
    expect(() => ast.parseFile(com)).not.toThrow();

    const sem = svc.apply(com, {
      method: 'run',
      blocks: [{ id: 'fluxo.retornar-status', slots: { status: 'false', msg: '"x"' }, children: {} }],
    }, null);
    expect(sem).not.toContain('GetUserUsecase');
    expect(sem).toContain('return { status: false, msg: "x" };');
    expect(() => ast.parseFile(sem)).not.toThrow();
  });

  it('comentario @block desambigua para codigo livre', () => {
    const hinted = 'class A {\n  async run() {\n    // @block:livre.codigo-livre\n    const check = await repository.getById({ id: 1 });\n  }\n}\nmodule.exports = A;\n';
    const plain = 'class A {\n  async run() {\n    const check = await repository.getById({ id: 1 });\n  }\n}\nmodule.exports = A;\n';
    expect(svc.decompose(hinted, null).methods[0].blocks.map((b) => b.id)).toEqual(['livre.codigo-livre']);
    expect(svc.decompose(plain, null).methods[0].blocks.map((b) => b.id)).toEqual(['dados.chamar-repositorio']);
  });

  it('try/catch com logExeption acrescenta os requires quando o arquivo nao os tem', () => {
    const src = 'class A {\n  async run() {\n    return 1;\n  }\n}\nmodule.exports = A;\n';
    const out = svc.apply(src, {
      method: 'run',
      blocks: [{
        id: 'fluxo.try-catch-log',
        slots: { erro: 'err', descricao: "'falhou'" },
        children: { corpo: [{ id: 'fluxo.retornar-status', slots: { status: 'true', msg: '"ok"' }, children: {} }] },
      }],
    }, null);
    expect(out).toContain('const ErrorStackParser = require("error-stack-parser");');
    expect(out).toContain('const logExeption = require("../Logs/exeption/exeptionDesafioAutenticacao");');
    expect(out).toContain('logExeption(');
    expect(() => ast.parseFile(out)).not.toThrow();
  });
});

describe('API de blocos', () => {
  let t;
  beforeEach(() => {
    t = createTempProject();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it('lista a biblioteca global e a do projeto, com override por id', async () => {
    const globalRes = await request(t.studio.app).get('/api/blocks');
    expect(globalRes.status).toBe(200);
    expect(globalRes.body.blocks.map((b) => b.id)).toEqual(expect.arrayContaining(['fluxo.guard-status', 'livre.codigo-livre']));

    const over = {
      id: 'fluxo.guard-status',
      label: 'Guard do projeto',
      categoria: 'fluxo',
      icone: 'shield',
      priority: 80,
      slots: [],
      imports: [],
      template: 'if (!{{alvo}}.status) return { status: false, msg: "projeto" }',
      pattern: { kind: 'guard' },
      containers: [],
    };
    const rel = '.studio/blocks/fluxo/guard-status.block.json';
    const abs = path.join(t.root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(over, null, 2)}\n`);

    const res = await request(t.studio.app).get('/api/projects/teste/blocks');
    expect(res.status).toBe(200);
    const guard = res.body.blocks.find((b) => b.id === 'fluxo.guard-status');
    expect(guard.label).toBe('Guard do projeto');
    expect(guard.origin).toBe('project');
  });

  it('GET do fluxo e PUT sem editar devolve unchanged; baseHash errado da 409', async () => {
    const flow = await request(t.studio.app)
      .get('/api/projects/teste/blocks/flow')
      .query({ path: '@core/usecase/Foo/createFooUseCase.js' });
    expect(flow.status).toBe(200);
    const method = flow.body.methods.find((m) => m.name === 'run');
    expect(method).toBeTruthy();

    const same = await request(t.studio.app)
      .put('/api/projects/teste/blocks/flow')
      .query({ path: '@core/usecase/Foo/createFooUseCase.js' })
      .send({ method: 'run', className: method.className, blocks: method.blocks, baseHash: flow.body.hash });
    expect(same.status).toBe(200);
    expect(same.body.unchanged).toBe(true);

    const conflict = await request(t.studio.app)
      .put('/api/projects/teste/blocks/flow')
      .query({ path: '@core/usecase/Foo/createFooUseCase.js' })
      .send({ method: 'run', blocks: method.blocks, baseHash: '0'.repeat(64) });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('CONFLICT');
    expect(conflict.body.currentHash).toBe(flow.body.hash);
  });
});
