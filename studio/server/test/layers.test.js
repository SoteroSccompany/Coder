'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createTempProject } = require('./helpers');
const { parseFile, print } = require('../src/services/astService');

function parseia(arquivo) {
  const source = fs.readFileSync(arquivo, 'utf8');
  const ast = parseFile(source);
  expect(print(parseFile(print(ast)))).toBe(print(ast));
  return source;
}

const DOMAIN = `
const uuid = require('uuid');
class PessoaDomain {
    constructor(data) {
        this.id = data.id ? data.id : uuid.v4()
        this.nome = data.nome
    }

    getPessoa() {
        return {
            id: this.id,
            nome: this.nome,
        }
    }

    setPessoa(data) {
        /* marca-set */
        this.nome = data.nome ? data.nome : this.nome
        return this.getPessoa()
    }

    extra() {
        return 'mantido';
    }
}

module.exports = PessoaDomain;
`;

describe('layers', () => {
  let t;
  beforeEach(() => {
    t = createTempProject({
      '@core/domain/Pessoa.js': DOMAIN,
      'infrastructure/routes/index.js':
        "const express = require('express');\nconst router = express.Router();\nmodule.exports = router;\n",
      'infrastructure/Controllers/PedidoController.js':
        'class PedidoController {\n    async ping(req, res) { res.end("ok"); }\n}\nmodule.exports = new PedidoController();\n',
    });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const api = () => request(t.studio.app);

  it('atualiza construtor e getX e preserva o resto do domain', async () => {
    const lido = await api().get('/api/projects/teste/layers/domain').query({ path: '@core/domain/Pessoa.js' });
    expect(lido.status).toBe(200);
    expect(lido.body.fields.map((f) => f.name)).toEqual(['id', 'nome']);
    expect(lido.body.fields[0].kind).toBe('uuid');
    expect(lido.body.fields[1].kind).toBe('plain');

    const salvo = await api()
      .put('/api/projects/teste/layers/domain')
      .query({ path: '@core/domain/Pessoa.js' })
      .send({
        baseHash: lido.body.hash,
        fields: [
          { name: 'id', kind: 'uuid' },
          { name: 'nome', kind: 'plain' },
          { name: 'ativo', kind: 'boolean' },
        ],
      });
    expect(salvo.status).toBe(200);
    const source = parseia(path.join(t.root, '@core/domain/Pessoa.js'));
    expect(source).toContain('/* marca-set */');
    expect(source).toContain("return 'mantido'");
    expect(source).toContain('this.ativo = data.ativo === true || data.ativo === false ? data.ativo : false');
    expect(source).toContain('ativo: this.ativo');
    expect(source).toContain('setPessoa');
    expect(salvo.body.fields.map((f) => f.name)).toEqual(['id', 'nome', 'ativo']);
  });

  it('recusa domain com baseHash velho (409)', async () => {
    const lido = await api().get('/api/projects/teste/layers/domain').query({ path: '@core/domain/Pessoa.js' });
    fs.writeFileSync(path.join(t.root, '@core/domain/Pessoa.js'), `${DOMAIN}\n// disco\n`);
    const salvo = await api()
      .put('/api/projects/teste/layers/domain')
      .query({ path: '@core/domain/Pessoa.js' })
      .send({ baseHash: lido.body.hash, fields: [{ name: 'nome', kind: 'plain' }] });
    expect(salvo.status).toBe(409);
    expect(salvo.body.code).toBe('CONFLICT');
  });

  it('gera migration knex que o recast consegue ler', async () => {
    const res = await api()
      .post('/api/projects/teste/layers/migrations')
      .send({
        table: 'tab_pessoa',
        columns: [
          { name: 'id', type: 'string', length: 39, pk: true },
          { name: 'nome', type: 'string', length: 120 },
          { name: 'criado_em', type: 'datetime' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.path).toMatch(/knex\/migrations\/\d{14}_tab_pessoa\.js$/);
    const source = parseia(path.join(t.root, res.body.path));
    expect(source).toContain("const tableName = 'tab_pessoa'");
    expect(source).toContain('exports.up');
    expect(source).toContain('exports.down');
    expect(source).toContain(".primary()");
    expect(source).toContain('createTable');
  });

  it('cria a entidade (domain, repository, use cases, controller e log) sem mexer no .env', async () => {
    const res = await api().post('/api/projects/teste/layers/entidade').send({
      entity: 'Nota',
      table: 'tab_nota',
      fields: ['id', 'nome', 'data_criacao'],
    });
    expect(res.status).toBe(201);
    const rels = res.body.arquivos.map((a) => a.path);
    expect(rels).toEqual(expect.arrayContaining([
      '@core/domain/Nota.js',
      'infrastructure/db/services/NotaRepository.js',
      '@core/usecase/Nota/getNotaUseCase.js',
      '@core/usecase/Nota/createNotaUseCase.js',
      '@core/usecase/Nota/updateNotaUseCase.js',
      '@core/usecase/Nota/deleteNotaUseCase.js',
      'infrastructure/Controllers/NotaController.js',
      '@core/usecase/Logs/exeption/exeptionNota.js',
    ]));
    for (const rel of rels) parseia(path.join(t.root, rel));
    const domain = fs.readFileSync(path.join(t.root, '@core/domain/Nota.js'), 'utf8');
    expect(domain).toContain('class NotaDomain');
    expect(domain).toContain('getNota()');
    expect(domain).not.toContain('IdentificacaoBiometrica');
    expect(fs.readFileSync(path.join(t.root, '.env'), 'utf8')).toBe('SEGREDO=1\n');
    expect(fs.existsSync(path.join(t.root, 'Logs/exeptions'))).toBe(false);
  });

  it('insere metodo knex no repositorio', async () => {
    const arquivo = 'infrastructure/db/services/PessoaRepository.js';
    fs.mkdirSync(path.join(t.root, 'infrastructure/db/services'), { recursive: true });
    fs.writeFileSync(
      path.join(t.root, arquivo),
      "const BaseRepository = require('.');\nclass PessoaRepository extends BaseRepository {\n    constructor() {\n        super({ tableName: 'tab_pessoa', knexOrTransaction: knex })\n    }\n}\nmodule.exports = new PessoaRepository();\n",
    );
    const lido = await api().get('/api/projects/teste/layers/repository').query({ path: arquivo });
    expect(lido.status).toBe(200);
    expect(lido.body.tableName).toBe('tab_pessoa');
    const salvo = await api()
      .post('/api/projects/teste/layers/repository/metodo')
      .query({ path: arquivo })
      .send({ baseHash: lido.body.hash, kind: 'insert', name: 'inserirPessoa' });
    expect(salvo.status).toBe(200);
    const source = parseia(path.join(t.root, arquivo));
    expect(source).toContain("knex('tab_pessoa').insert(data)");
    expect(source).toContain('async inserirPessoa');
  });

  it('acrescenta rota e handler minimo', async () => {
    const rotas = await api().get('/api/projects/teste/layers/rotas');
    expect(rotas.status).toBe(200);
    const arq = 'infrastructure/routes/index.js';
    const ctrl = 'infrastructure/Controllers/PedidoController.js';
    const salvo = await api().post('/api/projects/teste/layers/rotas').send({
      action: 'add',
      file: arq,
      method: 'get',
      path: '/pedido',
      handler: 'PedidoController.getPedido',
      controllerPath: ctrl,
      baseHash: rotas.body.arquivos[arq].hash,
      controllerBaseHash: rotas.body.arquivos[ctrl].hash,
    });
    expect(salvo.status).toBe(200);
    expect(salvo.body.handlerCriado).toBe(true);
    const routesSrc = parseia(path.join(t.root, arq));
    const ctrlSrc = parseia(path.join(t.root, ctrl));
    expect(routesSrc).toMatch(/router\.get\((['"])\/pedido\1, PedidoController\.getPedido\)/);
    expect(routesSrc).toContain('PedidoController');
    expect(ctrlSrc).toContain('async getPedido');
    expect(ctrlSrc).toContain('async ping');
  });

  it('cria consumidor de fila na camada worker', async () => {
    const res = await api().post('/api/projects/teste/layers/workers').send({ nome: 'Pedido', fila: 'fila.pedido' });
    expect(res.status).toBe(201);
    expect(res.body.path).toBe('infrastructure/queue/workers/Pedido/index.js');
    const source = parseia(path.join(t.root, res.body.path));
    expect(source).toContain('assertQueue');
    expect(source).toContain('fila.pedido');
  });
});
