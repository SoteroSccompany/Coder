'use strict';

/**
 * Decompoe o corpo de cada metodo de classe em uma arvore de blocos.
 * Statement sem casamento vira `livre.codigo-livre` com o texto original.
 * O comentario `// @block:<id>` escolhe o bloco quando o pattern dele casa;
 * se nao casar, o statement fica livre (nao reescreve no chute).
 */

const traverse = require('@babel/traverse').default;
const { matchBlock, sliceNode } = require('./match');

const FREE_ID = 'livre.codigo-livre';
const COMMENT_ID = 'livre.comentario';

function classNameOf(classPath) {
  const node = classPath.node;
  if (node.id && node.id.name) return node.id.name;
  const parent = classPath.parent;
  if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if (parent && parent.type === 'AssignmentExpression') {
    const l = parent.left;
    if (l.type === 'MemberExpression' && l.object.type === 'Identifier' && l.property.type === 'Identifier') {
      return `${l.object.name}.${l.property.name}`;
    }
    if (l.type === 'Identifier') return l.name;
  }
  return null;
}

function methodKey(m) {
  const k = m.key;
  if (m.type === 'ClassPrivateMethod') return `#${k.id.name}`;
  if (k.type === 'Identifier') return k.name;
  if (k.type === 'StringLiteral') return k.value;
  if (k.type === 'NumericLiteral') return String(k.value);
  return null;
}

function hintOf(node) {
  const comments = node && node.leadingComments ? node.leadingComments : [];
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const m = String(comments[i].value || '').match(/@block:\s*([A-Za-z0-9_.-]+)/);
    if (m) return m[1];
  }
  return null;
}

function sequenceSource(source, list, minStart) {
  if (!list.length) return '';
  const first = list[0];
  const last = list[list.length - 1];
  let start = first.start;
  for (const c of first.leadingComments || []) {
    if (typeof c.start === 'number' && c.start < start && (minStart == null || c.start >= minStart)) {
      start = c.start;
    }
  }
  if (typeof first.start !== 'number' || typeof last.end !== 'number') return '';
  return source.slice(start, last.end);
}

function freeNode(source, stmt, minStart, hint) {
  const text = sequenceSource(source, [stmt], minStart);
  return {
    id: FREE_ID,
    variant: null,
    geracao: null,
    slots: { codigo: text },
    children: {},
    source: text,
    pristine: true,
    hint,
  };
}

function commentNode(source, stmt, minStart) {
  const texts = (stmt.leadingComments || [])
    .map((c) => String(c.value || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && !/@block:/.test(t));
  const text = sequenceSource(source, [stmt], minStart);
  return {
    id: COMMENT_ID,
    variant: null,
    geracao: null,
    slots: { texto: texts.join(' ').trim() },
    children: {},
    source: text,
    pristine: true,
    hint: null,
  };
}

function toNode(block, m, source, stmts, index, minStart) {
  const part = stmts.slice(index, index + m.span);
  return {
    id: block.id,
    variant: m.variant || null,
    geracao: m.geracao || null,
    slots: m.slots || {},
    children: m.children || {},
    source: sequenceSource(source, part, minStart),
    pristine: true,
    hint: hintOf(stmts[index]),
    templateOverride: m.templateOverride || null,
    imports: m.imports || null,
  };
}

function decomposeList(stmts, source, library, minStart) {
  const ctx = {
    source,
    decomposeList: (inner, innerMin) => decomposeList(inner || [], source, library, innerMin),
  };
  const out = [];
  let i = 0;
  while (i < stmts.length) {
    const stmt = stmts[i];
    if (!stmt || stmt.type === 'EmptyStatement') {
      out.push(commentNode(source, stmt || { leadingComments: [], start: minStart || 0, end: minStart || 0 }, minStart));
      i += 1;
      continue;
    }
    const hint = hintOf(stmt);
    if (hint === FREE_ID) {
      out.push(freeNode(source, stmt, minStart, hint));
      i += 1;
      continue;
    }
    const found = [];
    for (const block of library) {
      if (!block || block.id === FREE_ID || block.id === COMMENT_ID) continue;
      let m = null;
      try {
        m = matchBlock(block, stmts, i, ctx);
      } catch {
        m = null;
      }
      if (m) found.push({ block, m });
    }
    found.sort((a, b) => b.m.score - a.m.score);
    let chosen = null;
    if (hint) {
      chosen = found.find((f) => f.block.id === hint) || null;
      if (!chosen) {
        out.push(freeNode(source, stmt, minStart, hint));
        i += 1;
        continue;
      }
    } else if (found.length === 1 || (found.length > 1 && found[0].m.score > found[1].m.score)) {
      chosen = found[0];
    }
    if (!chosen) {
      out.push(freeNode(source, stmt, minStart, hint));
      i += 1;
      continue;
    }
    out.push(toNode(chosen.block, chosen.m, source, stmts, i, minStart));
    i += chosen.m.span;
  }
  return out;
}

function paramsOf(method) {
  if (!method.params) return '';
  return method.params.map((p) => sliceNode('', p) || (p.name || '')).join(', ');
}

/**
 * @param {string} source
 * @param {Array<object>} library lista de definicoes (ja mesclada)
 * @returns {{ methods: Array<object> }}
 */
function decomposeSource(source, library, parseFile) {
  const ast = parseFile(source);
  const methods = [];
  traverse(ast, {
    noScope: true,
    Class(classPath) {
      const className = classNameOf(classPath);
      for (const m of classPath.node.body.body) {
        if (m.type !== 'ClassMethod' && m.type !== 'ClassPrivateMethod') continue;
        const name = methodKey(m);
        if (!name || !m.body || m.body.type !== 'BlockStatement') continue;
        const blocks = decomposeList(m.body.body || [], source, library, m.body.start + 1);
        methods.push({
          className,
          name,
          async: !!m.async,
          static: !!m.static,
          kind: m.kind,
          params: (m.params || []).map((p) => (typeof p.start === 'number' ? source.slice(p.start, p.end) : p.name || '')).join(', '),
          blocks,
        });
      }
    },
  });
  return { methods };
}

/** Igualdade estrutural usada no fast-path (ignora `source`: o texto original volta inteiro). */
function sameTree(a, b) {
  const aa = a || [];
  const bb = b || [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i += 1) {
    if (!sameNode(aa[i], bb[i])) return false;
  }
  return true;
}

function sameNode(a, b) {
  if (!a || !b) return false;
  if (a.id !== b.id) return false;
  if ((a.variant || null) !== (b.variant || null)) return false;
  if ((a.geracao || null) !== (b.geracao || null)) return false;
  if (!sameSlots(a.slots || {}, b.slots || {})) return false;
  const keys = new Set([...Object.keys(a.children || {}), ...Object.keys(b.children || {})]);
  for (const k of keys) {
    if (!sameTree((a.children && a.children[k]) || [], (b.children && b.children[k]) || [])) return false;
  }
  return true;
}

function sameSlots(a, b) {
  const ak = Object.keys(a).filter((k) => a[k] != null && a[k] !== '').sort();
  const bk = Object.keys(b).filter((k) => b[k] != null && b[k] !== '').sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i += 1) {
    if (ak[i] !== bk[i]) return false;
    if (String(a[ak[i]]) !== String(b[bk[i]])) return false;
  }
  return true;
}

module.exports = {
  FREE_ID,
  COMMENT_ID,
  decomposeSource,
  decomposeList,
  sameTree,
  classNameOf,
  methodKey,
  paramsOf,
};
