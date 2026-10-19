'use strict';

/**
 * Gera o JS de um fluxo e encaixa no metodo, sem mexer no resto do arquivo
 * quando nada mudou. Imports declarados pelo bloco entram ou saem do topo.
 */

const traverse = require('@babel/traverse').default;
const { decomposeSource, sameTree, methodKey, classNameOf } = require('./decompose');

const CALL_TEMPLATES = {
  'const-await': 'const {{variavel}} = await {{alvo}}.{{metodo}}({{argumentos}});',
  const: 'const {{variavel}} = {{alvo}}.{{metodo}}({{argumentos}});',
  await: 'await {{alvo}}.{{metodo}}({{argumentos}});',
  expr: '{{alvo}}.{{metodo}}({{argumentos}});',
  'assign-await': '{{variavel}} = await {{alvo}}.{{metodo}}({{argumentos}});',
  assign: '{{variavel}} = {{alvo}}.{{metodo}}({{argumentos}});',
  'return-await': 'return await {{alvo}}.{{metodo}}({{argumentos}});',
  return: 'return {{alvo}}.{{metodo}}({{argumentos}});',
};

const NEW_TEMPLATE = 'const {{variavel}} = new {{classe}}({{argumentos}});';

function eolOf(source) {
  const crlf = (source.match(/\r\n/g) || []).length;
  const lf = (source.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

function templateFor(def, node) {
  if (!def) return (node.slots && node.slots.codigo) || '';
  if (node.templateOverride) return node.templateOverride;
  if (node.variant && def.templates && def.templates[node.variant]) return def.templates[node.variant];
  const patterns = Array.isArray(def.pattern) ? def.pattern : def.pattern ? [def.pattern] : [];
  if (node.variant) {
    const hit = patterns.find((p) => p && p.variant === node.variant && p.template);
    if (hit) return hit.template;
  }
  if ((node.geracao === 'chamada' || def.geracao === 'chamada') && node.variant && CALL_TEMPLATES[node.variant]) {
    return CALL_TEMPLATES[node.variant];
  }
  if (node.geracao === 'new' && def.template && def.template.includes('{{classe}}')) return def.template;
  if (node.geracao === 'new' && def.template && /new\s+\S/.test(def.template)) return def.template;
  if (node.geracao === 'new') return NEW_TEMPLATE;
  return def.template || '';
}

function emitNode(node, library, indent, eol) {
  if (!node) return '';
  // So usa o texto original quando o cliente afirma que o bloco nao foi editado.
  // `pristine` ausente significa "gerar pelo template" (bloco novo ou alterado).
  if (node.pristine === true && typeof node.source === 'string' && node.source.length) {
    return indentSource(node.source, indent, eol);
  }
  if (node.id === 'livre.codigo-livre') {
    return indentSource((node.slots && node.slots.codigo) || '', indent, eol);
  }
  if (node.id === 'livre.comentario') {
    const texto = String((node.slots && node.slots.texto) || '').replace(/\s+/g, ' ').trim();
    return `${' '.repeat(indent)}// ${texto}`;
  }
  const def = library.get(node.id);
  const tpl = templateFor(def, node);
  return fill(tpl, node, library, indent, eol);
}

function indentSource(raw, indent, eol) {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
  const pad = ' '.repeat(indent);
  return lines
    .map((line, i) => {
      if (!line.trim()) return '';
      if (i === 0) return pad + line.replace(/^\s+/, '');
      return line;
    })
    .filter((line, i, arr) => line !== '' || (i > 0 && i < arr.length - 1))
    .join(eol);
}

function fill(tpl, node, library, indent, eol) {
  const childIndent = indent + 4;
  let text = String(tpl || '');
  text = text.replace(/^[ \t]*\{\{#(\w+)\}\}[ \t]*$/gm, (_, name) => {
    const kids = (node.children && node.children[name]) || [];
    if (!kids.length) return '';
    return kids.map((k) => `\u0000${emitNode(k, library, childIndent, eol)}`).join(eol);
  });
  text = text.replace(/\{\{(\w+)\??\}\}/g, (_, name) => {
    const slots = node.slots || {};
    if (slots[name] == null) return '';
    return String(slots[name]);
  });
  const pad = ' '.repeat(indent);
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('\u0000')) out.push(line.slice(1));
    else if (line.trim()) out.push(pad + line.replace(/^\s+/, ''));
  }
  return out.join(eol);
}

function detectIndent(source, bodyNode) {
  const inner = source.slice(bodyNode.start + 1, bodyNode.end - 1);
  const m = inner.match(/\n([ \t]+)\S/);
  if (m) return m[1].replace(/\t/g, '    ').length;
  return 8;
}

function findMethod(ast, className, methodName) {
  let found = null;
  traverse(ast, {
    noScope: true,
    Class(classPath) {
      const cn = classNameOf(classPath);
      for (const m of classPath.node.body.body) {
        if (m.type !== 'ClassMethod' && m.type !== 'ClassPrivateMethod') continue;
        if (methodKey(m) !== methodName) continue;
        if (className && cn !== className) continue;
        found = m;
      }
    },
  });
  return found;
}

function spliceMethod(source, methodNode, inner, eol) {
  const body = methodNode.body;
  const original = source.slice(body.start + 1, body.end - 1);
  const nl = original.startsWith('\r\n') ? '\r\n' : original.startsWith('\n') ? '\n' : eol;
  const tail = original.match(/(\r?\n)([ \t]*)$/);
  let insertion = inner;
  if (!insertion.startsWith('\n') && !insertion.startsWith('\r')) insertion = nl + insertion;
  if (tail) insertion += tail[1] + tail[2];
  else if (!insertion.endsWith('\n')) insertion += nl;
  return source.slice(0, body.start + 1) + insertion + source.slice(body.end - 1);
}

function walkNodes(blocks, fn) {
  for (const n of blocks || []) {
    fn(n);
    const children = n.children || {};
    for (const k of Object.keys(children)) walkNodes(children[k], fn);
  }
}

function importNames(imp) {
  if (Array.isArray(imp.destructure) && imp.destructure.length) return imp.destructure.slice();
  if (Array.isArray(imp.names) && imp.names.length) return imp.names.slice();
  if (imp.local) return [imp.local];
  return [];
}

function importKey(imp) {
  const names = importNames(imp).slice().sort().join(',');
  return `${imp.source}::${names}::${imp.invoke ? '1' : '0'}`;
}

function renderImport(imp) {
  const src = JSON.stringify(imp.source);
  if (Array.isArray(imp.destructure) && imp.destructure.length) {
    return `const { ${imp.destructure.join(', ')} } = require(${src});`;
  }
  const local = imp.local;
  return `const ${local} = require(${src})${imp.invoke ? '()' : ''};`;
}

function describeRequire(stmt) {
  if (!stmt || stmt.type !== 'VariableDeclaration' || stmt.declarations.length !== 1) return null;
  const d = stmt.declarations[0];
  let init = d.init;
  let invoke = false;
  if (init && init.type === 'CallExpression' && init.callee && init.callee.type === 'CallExpression') {
    invoke = true;
    init = init.callee;
  }
  if (!init || init.type !== 'CallExpression') return null;
  if (!init.callee || init.callee.type !== 'Identifier' || init.callee.name !== 'require') return null;
  if (!init.arguments || init.arguments.length !== 1 || init.arguments[0].type !== 'StringLiteral') return null;
  const source = init.arguments[0].value;
  if (d.id.type === 'Identifier') {
    return { local: d.id.name, source, invoke, destructure: null, names: [d.id.name] };
  }
  if (d.id.type === 'ObjectPattern') {
    const names = [];
    for (const p of d.id.properties) {
      if (p.type !== 'ObjectProperty' || p.computed) return null;
      const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
      const local = p.value && p.value.type === 'Identifier' ? p.value.name : key;
      if (!key || !local) return null;
      names.push(local);
    }
    return { local: names[0], source, invoke, destructure: names, names };
  }
  return null;
}

function isUseStrict(stmt) {
  return stmt && stmt.type === 'ExpressionStatement' && stmt.expression.type === 'Literal' && stmt.expression.value === 'use strict';
}

function collectPatternIds(id, into) {
  if (!id) return;
  if (id.type === 'Identifier') into.add(id.name);
  else if (id.type === 'ObjectPattern' || id.type === 'ArrayPattern') {
    for (const p of id.properties || id.elements || []) {
      if (!p) continue;
      if (p.type === 'RestElement') collectPatternIds(p.argument, into);
      else if (p.type === 'ObjectProperty') collectPatternIds(p.value, into);
      else if (p.type === 'AssignmentPattern') collectPatternIds(p.left, into);
      else collectPatternIds(p, into);
    }
  }
}

function collectRefs(ast, traverseFn) {
  const names = new Set();
  traverseFn(ast, {
    Identifier(p) {
      if (typeof p.isReferencedIdentifier === 'function' && p.isReferencedIdentifier()) names.add(p.node.name);
    },
  });
  return names;
}

function bindingsOf(stmt, into) {
  if (!stmt) return;
  if (stmt.type === 'FunctionDeclaration' && stmt.id) into.add(stmt.id.name);
  if (stmt.type === 'ClassDeclaration' && stmt.id) into.add(stmt.id.name);
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) collectPatternIds(d.id, into);
  }
}

function managedKeys(library) {
  const keys = new Set();
  for (const def of library.values()) {
    const bag = [...(def.imports || [])];
    const patterns = Array.isArray(def.pattern) ? def.pattern : def.pattern ? [def.pattern] : [];
    for (const p of patterns) {
      if (p && p.imports) bag.push(...p.imports);
    }
    for (const imp of bag) {
      if (imp && imp.source) keys.add(importKey(imp));
    }
  }
  return keys;
}

function collectNeeded(blocks, library) {
  const out = [];
  const seen = new Set();
  walkNodes(blocks, (node) => {
    const def = library.get(node.id);
    const list = [];
    if (node.imports && node.imports.length) list.push(...node.imports);
    else if (def && def.imports) list.push(...def.imports);
    for (const imp of list) {
      if (!imp || !imp.source) continue;
      const k = importKey(imp);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(imp);
    }
  });
  return out;
}

function syncImports(source, needed, library, parseFile) {
  const ast = parseFile(source);
  const body = ast.program.body;
  let refs = null;
  try {
    refs = collectRefs(ast, traverse);
  } catch {
    refs = null;
  }
  const managed = managedKeys(library);
  const described = body.map((stmt) => ({ stmt, req: describeRequire(stmt) }));
  const neededKeys = new Set(needed.map(importKey));
  const removals = [];
  for (const item of described) {
    if (!item.req) continue;
    const key = importKey(item.req);
    if (!managed.has(key)) continue;
    if (neededKeys.has(key)) continue;
    if (refs == null) continue;
    if (item.req.names.some((n) => refs.has(n))) continue;
    removals.push(item);
  }

  const bound = new Set();
  for (const item of described) bindingsOf(item.stmt, bound);
  for (const r of removals) r.req.names.forEach((n) => bound.delete(n));

  const present = new Set(
    described.filter((d) => d.req && !removals.includes(d)).map((d) => importKey(d.req)),
  );
  const additions = [];
  for (const imp of needed) {
    const key = importKey(imp);
    if (present.has(key)) continue;
    const names = importNames(imp);
    if (names.some((n) => bound.has(n))) continue;
    additions.push(imp);
    names.forEach((n) => bound.add(n));
    present.add(key);
  }
  if (!removals.length && !additions.length) return source;

  let out = source;
  const cuts = removals
    .map((r) => {
      let end = r.stmt.end;
      if (out[end] === '\r') end += 1;
      if (out[end] === '\n') end += 1;
      return { start: r.stmt.start, end };
    })
    .sort((a, b) => b.start - a.start);
  for (const c of cuts) out = out.slice(0, c.start) + out.slice(c.end);

  if (!additions.length) return out;
  const ast2 = parseFile(out);
  let insertAt = 0;
  let saw = false;
  for (const stmt of ast2.program.body) {
    if (isUseStrict(stmt) || describeRequire(stmt)) {
      insertAt = stmt.end;
      saw = true;
    } else break;
  }
  const eol = eolOf(out);
  const chunk = additions.map(renderImport).join(eol);
  if (!saw) return `${chunk}${eol}${out}`;
  const lead = out[insertAt - 1] === '\n' ? '' : eol;
  return out.slice(0, insertAt) + lead + eol + chunk + out.slice(insertAt);
}

/**
 * Aplica um fluxo a UM metodo. Se a arvore for igual a decomposicao atual, devolve
 * o arquivo byte a byte (round-trip sem diff).
 */
function applyFlow(source, { className, method, blocks }, library, parseFile) {
  const decoded = decomposeSource(source, library, parseFile);
  const current = decoded.methods.find((m) => m.name === method && (!className || m.className === className));
  if (!current) {
    const err = new Error(`Metodo nao encontrado: ${method}`);
    err.code = 'METHOD_NOT_FOUND';
    throw err;
  }
  if (sameTree(current.blocks, blocks)) return source;

  const ast = parseFile(source);
  const methodNode = findMethod(ast, className || current.className, method);
  if (!methodNode || !methodNode.body) {
    const err = new Error(`Metodo nao encontrado: ${method}`);
    err.code = 'METHOD_NOT_FOUND';
    throw err;
  }
  const eol = eolOf(source);
  const indent = detectIndent(source, methodNode.body);
  const libMap = library instanceof Map ? library : new Map(library.map((b) => [b.id, b]));
  const inner = (blocks || []).map((n) => emitNode(n, libMap, indent, eol)).filter(Boolean).join(eol);
  let next = spliceMethod(source, methodNode, inner, eol);

  const needed = [];
  const seen = new Set();
  for (const m of decoded.methods) {
    const tree = m.name === current.name && (!className || m.className === current.className) ? blocks : m.blocks;
    for (const imp of collectNeeded(tree, libMap)) {
      const k = importKey(imp);
      if (seen.has(k)) continue;
      seen.add(k);
      needed.push(imp);
    }
  }
  next = syncImports(next, needed, libMap, parseFile);
  parseFile(next);
  return next;
}

module.exports = {
  applyFlow,
  emitNode,
  templateFor,
  CALL_TEMPLATES,
  syncImports,
  renderImport,
  collectNeeded,
  eolOf,
};
