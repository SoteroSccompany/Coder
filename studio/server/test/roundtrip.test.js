'use strict';

/**
 * Round-trip (parse -> print sem alteracoes) de TODOS os .js de api/@core/usecase e api/@core/domain.
 * Estes testes apenas LEEM a pasta api/ (nunca escrevem).
 */

const fs = require('fs');
const path = require('path');
const { parseFile, print, roundTrip, listClassMethods } = require('../src/services/astService');

const API = path.resolve(__dirname, '../../../api');
const DIRS = ['@core/usecase', '@core/domain'];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(API, d))).sort();

describe('round-trip recast (api/@core)', () => {
  it('encontra arquivos para testar', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.map((f) => [path.relative(API, f), f]))('%s -> zero diff', (_rel, abs) => {
    const source = fs.readFileSync(abs, 'utf8');
    expect(roundTrip(source) === source).toBe(true);
  });
});

describe('astService', () => {
  it('preserva CRLF e BOM', () => {
    const src = '\uFEFFconst a = 1;\r\nclass X {\r\n  m() {}\r\n}\r\n';
    expect(roundTrip(src)).toBe(src);
  });

  it('lista metodos de classe com nome, range e async', () => {
    const src = "class Foo {\n  async a(x) { return x; }\n  b() {}\n  static async c() {}\n}\nmodule.exports = Foo;\n";
    const methods = listClassMethods(parseFile(src));
    expect(methods.map((m) => [m.className, m.name, m.async, m.static])).toEqual([
      ['Foo', 'a', true, false],
      ['Foo', 'b', false, false],
      ['Foo', 'c', true, true],
    ]);
    const a = methods[0];
    expect(src.slice(a.range.start, a.range.end)).toBe('async a(x) { return x; }');
    expect(a.loc.start.line).toBe(2);
  });

  it('lista metodos do use case real de exemplo', () => {
    const f = path.join(API, '@core/usecase/DesafioAutenticacao/createDesafioAutenticacaoUseCase.js');
    if (!fs.existsSync(f)) return;
    const methods = listClassMethods(parseFile(fs.readFileSync(f, 'utf8')));
    const names = methods.map((m) => m.name);
    expect(names).toContain('indexDesafioAutenticacao');
    expect(methods.find((m) => m.name === 'indexDesafioAutenticacao').async).toBe(true);
  });

  it('gera diff minimo ao alterar a AST', () => {
    const src = "class A {\n  m() {\n    return   1 ;\n  }\n}\n\nmodule.exports   =   A;\n";
    const ast = parseFile(src);
    const method = ast.program.body[0].body.body[0];
    method.async = true;
    const out = print(ast);
    expect(out).toContain('async m()');
    expect(out).toContain('module.exports   =   A;'); // trecho intocado preservado
  });
});
