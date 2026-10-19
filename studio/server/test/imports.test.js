'use strict';

/**
 * Imports declarados pelo bloco entram no topo ao gerar e saem
 * quando nenhum metodo do arquivo ainda usa o identificador.
 */

const { createBlockService } = require('../src/blocks/service');
const ast = require('../src/services/astService');

const svc = createBlockService({ ast, files: null, config: {} });

const REQUIRE_SHA = 'const { SHA } = require("../../../infrastructure/gateways/crypt/sha");';

const VAZIO = [
  'class CryptoUseCase {',
  '  async cifrar(data) {',
  '    return 1;',
  '  }',
  '  async outro(data) {',
  '    return 1;',
  '  }',
  '}',
  'module.exports = CryptoUseCase;',
  '',
].join('\n');

function blocoSha() {
  return {
    id: 'seguranca.sha',
    slots: { variavel: 'hash', argumentos: 'data.senha', alvo: 'sha', metodo: 'encrypt' },
    children: {},
  };
}

function blocoRetorno() {
  return {
    id: 'fluxo.retornar-status',
    slots: { status: 'true', msg: '"ok"' },
    children: {},
  };
}

describe('imports automaticos', () => {
  it('coloca o require do SHA no topo e remove quando ninguem mais usa', () => {
    const com = svc.apply(VAZIO, { className: 'CryptoUseCase', method: 'cifrar', blocks: [blocoSha()] }, null);
    const linhas = com.split('\n').filter((l) => l.trim());
    expect(linhas[0]).toBe(REQUIRE_SHA);
    expect(com.indexOf(REQUIRE_SHA)).toBeLessThan(com.indexOf('class CryptoUseCase'));
    expect(com).toContain('const hash = new SHA(data.senha);');
    expect(() => ast.parseFile(com)).not.toThrow();

    const ainda = svc.apply(com, { className: 'CryptoUseCase', method: 'outro', blocks: [blocoSha()] }, null);
    expect(ainda.split('\n').filter((l) => l.trim())[0]).toBe(REQUIRE_SHA);
    expect(ainda.match(/require\("\.\.\/\.\.\/\.\.\/infrastructure\/gateways\/crypt\/sha"\)/g)).toHaveLength(1);

    const umSai = svc.apply(ainda, { className: 'CryptoUseCase', method: 'cifrar', blocks: [blocoRetorno()] }, null);
    expect(umSai).toContain(REQUIRE_SHA);
    expect(umSai).toContain('new SHA(data.senha)');
    expect(umSai).toContain('return { status: true, msg: "ok" };');

    const sem = svc.apply(umSai, { className: 'CryptoUseCase', method: 'outro', blocks: [blocoRetorno()] }, null);
    expect(sem).not.toContain('SHA');
    expect(sem).not.toContain('require(');
    expect(sem).toContain('class CryptoUseCase');
    expect(sem).toContain('module.exports = CryptoUseCase;');
    expect(() => ast.parseFile(sem)).not.toThrow();
  });
});
