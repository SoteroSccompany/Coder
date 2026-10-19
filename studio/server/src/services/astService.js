'use strict';

/**
 * Parse/print de JS preservando formatacao (recast + @babel/parser).
 *
 *   parseFile(source)      -> AST (File do Babel enriquecido pelo recast)
 *   print(ast)             -> string (so reescreve o que foi alterado)
 *   listClassMethods(ast)  -> [{ className, name, async, static, kind, generator, range, loc }]
 *   roundTrip(source)      -> string; DEVE ser identica a `source` quando nada foi alterado
 *
 * Cuidados para round-trip exato:
 *  - `sourceType: 'unambiguous'` (CommonJS e ESM) e `tokens: true` (exigido pelo recast);
 *  - o terminador de linha (CRLF/LF) original e detectado e repassado ao print,
 *    pois o recast usaria o `os.EOL` por padrao.
 */

const recast = require('recast');
const babelParser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const BABEL_OPTIONS = {
  sourceType: 'unambiguous',
  allowImportExportEverywhere: true,
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowSuperOutsideMethod: true,
  allowUndeclaredExports: true,
  errorRecovery: false,
  tokens: true,
  plugins: [
    'jsx',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'classStaticBlock',
    'topLevelAwait',
    'dynamicImport',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
    'exportDefaultFrom',
    'importAttributes',
  ],
};

const parser = {
  parse(source) {
    return babelParser.parse(source, BABEL_OPTIONS);
  },
};

const eolByAst = new WeakMap();

/** Detecta o terminador de linha predominante (padrao "\n"). */
function detectEol(source) {
  const crlf = (source.match(/\r\n/g) || []).length;
  const lf = (source.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

/** Faz o parse de um arquivo JS. Lanca SyntaxError (com loc) se invalido. */
function parseFile(source) {
  const ast = recast.parse(source, { parser });
  eolByAst.set(ast, detectEol(source));
  return ast;
}

/** Gera o codigo a partir da AST preservando o estilo original. */
function print(ast) {
  return recast.print(ast, { lineTerminator: eolByAst.get(ast) || '\n' }).code;
}

function nameOfClass(path) {
  const node = path.node;
  if (node.id && node.id.name) return node.id.name;
  const parent = path.parent;
  if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if (parent && parent.type === 'AssignmentExpression') {
    const l = parent.left;
    // module.exports = class { ... }  ->  "module.exports"
    if (l.type === 'MemberExpression' && l.object.type === 'Identifier' && l.property.type === 'Identifier') {
      return `${l.object.name}.${l.property.name}`;
    }
    if (l.type === 'Identifier') return l.name;
  }
  return null;
}

function keyName(m) {
  const k = m.key;
  if (m.type === 'ClassPrivateMethod') return `#${k.id.name}`;
  if (k.type === 'Identifier') return k.name;
  if (k.type === 'StringLiteral') return k.value;
  if (k.type === 'NumericLiteral') return String(k.value);
  return null; // chave computada
}

/**
 * Lista os metodos de todas as classes do arquivo.
 * `range` = offsets absolutos [start, end) no texto original; `loc` = linha (1-based)/coluna.
 */
function listClassMethods(ast) {
  const out = [];
  traverse(ast, {
    noScope: true,
    Class(classPath) {
      const className = nameOfClass(classPath);
      for (const m of classPath.node.body.body) {
        if (m.type !== 'ClassMethod' && m.type !== 'ClassPrivateMethod') continue;
        out.push({
          className,
          name: keyName(m),
          async: !!m.async,
          static: !!m.static,
          generator: !!m.generator,
          kind: m.kind, // 'method' | 'constructor' | 'get' | 'set'
          range: { start: m.start, end: m.end },
          loc: {
            start: { line: m.loc.start.line, column: m.loc.start.column },
            end: { line: m.loc.end.line, column: m.loc.end.column },
          },
        });
      }
    },
  });
  return out;
}

/** parse + print sem alteracoes. Deve devolver exatamente `source`. */
function roundTrip(source) {
  return print(parseFile(source));
}

module.exports = { parseFile, print, listClassMethods, roundTrip, BABEL_OPTIONS };
