'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createTempProject } = require('./helpers');
const { createBlockDef } = require('../src/blocks/creator');
const { createBlockService } = require('../src/blocks/service');
const ast = require('../src/services/astService');

const TRECHO = 'const check = await repository.getById({ id: data.id });';

function paramsDoTrecho() {
  const variavel = TRECHO.indexOf('check');
  const metodo = TRECHO.indexOf('getById');
  const args = TRECHO.indexOf('{ id: data.id }');
  return [
    { name: 'variavel', start: variavel, end: variavel + 'check'.length },
    { name: 'metodo', start: metodo, end: metodo + 'getById'.length },
    { name: 'argumentos', start: args, end: args + '{ id: data.id }'.length },
  ];
}

describe('criador de bloco', () => {
  it('gera template e pattern que reconhecem o mesmo trecho', () => {
    const block = createBlockDef({
      code: TRECHO,
      id: 'dados.exemplo-criado',
      label: 'Exemplo criado',
      categoria: 'dados',
      icone: 'database',
      params: paramsDoTrecho(),
    });
    expect(block.template).toBe('const {{variavel}} = await repository.{{metodo}}({{argumentos}});');
    expect(block.priority).toBe(200);

    const svc = createBlockService({ ast, files: null, config: {} });
    const lib = svc.libraryFor(null);
    lib.push(block);
    const src = `class A {\n  async run() {\n    ${TRECHO}\n  }\n}\nmodule.exports = A;\n`;
    const { decomposeSource } = require('../src/blocks/decompose');
    const flow = decomposeSource(src, lib, ast.parseFile);
    expect(flow.methods[0].blocks).toHaveLength(1);
    expect(flow.methods[0].blocks[0].id).toBe('dados.exemplo-criado');
    expect(flow.methods[0].blocks[0].slots).toEqual({
      variavel: 'check',
      metodo: 'getById',
      argumentos: '{ id: data.id }',
    });
  });

  it('POST grava em .studio/blocks e o fluxo passa a reconhecer o trecho', async () => {
    const arquivo = [
      'class A {',
      '  async run() {',
      `    ${TRECHO}`,
      '  }',
      '}',
      'module.exports = A;',
      '',
    ].join('\n');
    const t = createTempProject({ '@core/usecase/Foo/createFooUseCase.js': arquivo });
    try {
      const criado = await request(t.studio.app)
        .post('/api/projects/teste/blocks')
        .send({
          code: TRECHO,
          id: 'dados.exemplo-criado',
          label: 'Exemplo criado',
          categoria: 'dados',
          params: paramsDoTrecho(),
          scope: 'project',
        });
      expect(criado.status).toBe(201);
      expect(criado.body.scope).toBe('project');
      const abs = path.join(t.root, criado.body.path);
      expect(fs.existsSync(abs)).toBe(true);
      const gravado = JSON.parse(fs.readFileSync(abs, 'utf8'));
      expect(gravado.id).toBe('dados.exemplo-criado');
      expect(gravado.template).toContain('{{variavel}}');

      const flow = await request(t.studio.app)
        .get('/api/projects/teste/blocks/flow')
        .query({ path: '@core/usecase/Foo/createFooUseCase.js', method: 'run' });
      expect(flow.status).toBe(200);
      expect(flow.body.methods[0].blocks.map((b) => b.id)).toEqual(['dados.exemplo-criado']);
    } finally {
      await t.cleanup();
    }
  });
});
