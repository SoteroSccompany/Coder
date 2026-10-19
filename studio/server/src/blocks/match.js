'use strict';

/**
 * Casa statements com o pattern de um bloco.
 *
 * Dois formatos (os dois vivem no `.block.json`):
 *  - DSL `{ kind: 'call' | 'new' | 'guard' | 'return-status' | 'if-else' | 'try-log' | 'transaction' | 'ledger' | 'publish' }`
 *  - AST `{ type, ... }` / `{ sequence: [...] }`, gerado pelo criador de blocos a partir do template.
 *    `$bind` captura um pedaco; `$container` marca filhos; `$as: 'expr'` aceita qualquer expressao.
 *
 * Empate de pontuacao entre blocos diferentes nao casa: o statement cai em codigo livre.
 */

const EXPR_DENY = new Set([
  'ExpressionStatement', 'BlockStatement', 'ReturnStatement', 'IfStatement', 'VariableDeclaration',
  'FunctionDeclaration', 'ClassDeclaration', 'TryStatement', 'ThrowStatement', 'WhileStatement',
  'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'BreakStatement',
  'ContinueStatement', 'DebuggerStatement', 'EmptyStatement', 'LabeledStatement', 'WithStatement',
  'ImportDeclaration', 'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportAllDeclaration',
  'CatchClause', 'SwitchCase',
]);

function isExpression(node) {
  return !!(node && node.type && !EXPR_DENY.has(node.type));
}

function sliceNode(source, node) {
  if (node && typeof node.start === 'number' && typeof node.end === 'number') {
    return source.slice(node.start, node.end);
  }
  return '';
}

function propKey(p) {
  if (!p || p.type !== 'ObjectProperty' || p.computed) return null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'StringLiteral') return p.key.value;
  return null;
}

function findProp(obj, name) {
  if (!obj || obj.type !== 'ObjectExpression') return null;
  for (const p of obj.properties) {
    if (propKey(p) === name) return p;
  }
  return null;
}

function exactPropSet(obj, names) {
  if (!obj || obj.type !== 'ObjectExpression') return false;
  const keys = [];
  for (const p of obj.properties) {
    const k = propKey(p);
    if (!k) return false;
    keys.push(k);
  }
  if (keys.length !== names.length) return false;
  const set = new Set(keys);
  return names.every((n) => set.has(n));
}

function regex(src) {
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}

/**
 * Desembrulha uma chamada no nivel do statement.
 * Formas: `const v = [await] obj.metodo(args)`, `v = ...`, `obj.prop = ...`,
 * `await obj.metodo(args)`, `obj.metodo(args)`, `return [await] obj.metodo(args)`.
 */
function unwrapCall(stmt, source) {
  if (!stmt) return null;
  let expr = null;
  let result = '';
  let shape = '';
  if (stmt.type === 'VariableDeclaration') {
    if (stmt.kind !== 'const' || stmt.declarations.length !== 1) return null;
    const d = stmt.declarations[0];
    if (!d.id || d.id.type !== 'Identifier') return null;
    result = d.id.name;
    expr = d.init;
    shape = 'const';
  } else if (stmt.type === 'ExpressionStatement') {
    expr = stmt.expression;
    if (expr && expr.type === 'AssignmentExpression' && expr.operator === '=') {
      result = sliceNode(source, expr.left);
      expr = expr.right;
      shape = 'assign';
    } else {
      shape = 'expr';
    }
  } else if (stmt.type === 'ReturnStatement') {
    expr = stmt.argument;
    shape = 'return';
  } else {
    return null;
  }
  if (!expr) return null;
  let awaited = false;
  if (expr.type === 'AwaitExpression') {
    awaited = true;
    expr = expr.argument;
  }
  if (!expr || expr.type !== 'CallExpression') return null;
  const cal = expr.callee;
  if (!cal || cal.type !== 'MemberExpression' || cal.computed || cal.optional) return null;
  if (!cal.property || cal.property.type !== 'Identifier') return null;
  if (!cal.object || cal.object.type !== 'Identifier') return null;
  const variant = shape === 'expr'
    ? (awaited ? 'await' : 'expr')
    : `${shape}${awaited ? '-await' : ''}`;
  // 'const-await' | 'const' | 'assign-await' | 'assign' | 'return-await' | 'return' | 'await' | 'expr'
  const variantNorm = shape === 'const' ? (awaited ? 'const-await' : 'const') : variant;
  return {
    await: awaited,
    object: cal.object.name,
    method: cal.property.name,
    args: (expr.arguments || []).map((a) => sliceNode(source, a)).join(', '),
    result,
    variant: variantNorm,
  };
}

function unwrapNew(stmt, source) {
  if (!stmt || stmt.type !== 'VariableDeclaration' || stmt.kind !== 'const') return null;
  if (stmt.declarations.length !== 1) return null;
  const d = stmt.declarations[0];
  if (!d.id || d.id.type !== 'Identifier' || !d.init || d.init.type !== 'NewExpression') return null;
  if (!d.init.callee || d.init.callee.type !== 'Identifier') return null;
  return {
    varName: d.id.name,
    ctor: d.init.callee.name,
    args: (d.init.arguments || []).map((a) => sliceNode(source, a)).join(', '),
  };
}

function nameOk(value, exact, match) {
  if (exact && value !== exact) return false;
  if (match) {
    const re = regex(match);
    if (!re || !re.test(value)) return false;
  }
  return true;
}

function matchCall(stmt, pattern, ctx) {
  const call = unwrapCall(stmt, ctx.source);
  if (!call) return null;
  if (pattern.await === true && !call.await) return null;
  if (pattern.await === false && call.await) return null;
  if (!nameOk(call.object, pattern.objectName, pattern.objectMatch)) return null;
  if (!nameOk(call.method, pattern.methodName, pattern.methodMatch)) return null;
  if (pattern.resultRequired && !call.result) return null;
  const slots = {
    alvo: call.object,
    metodo: call.method,
    argumentos: call.args,
    variavel: call.result,
  };
  return { span: 1, slots, children: {}, variant: call.variant, geracao: pattern.geracao || 'chamada' };
}

function matchNew(stmt, pattern, ctx) {
  const n = unwrapNew(stmt, ctx.source);
  if (!n) return null;
  if (!nameOk(n.ctor, pattern.ctorName, pattern.ctorMatch)) return null;
  return {
    span: 1,
    slots: { variavel: n.varName, classe: n.ctor, argumentos: n.args },
    children: {},
    variant: pattern.variant || 'instancia',
    geracao: pattern.geracao || 'new',
  };
}

function matchGuard(stmt, ctx) {
  if (stmt.type !== 'IfStatement' || stmt.alternate) return null;
  const test = stmt.test;
  if (!test || test.type !== 'UnaryExpression' || test.operator !== '!') return null;
  const arg = test.argument;
  if (!arg || arg.type !== 'MemberExpression' || arg.computed || arg.optional) return null;
  if (!arg.property || arg.property.type !== 'Identifier' || arg.property.name !== 'status') return null;
  let ret = stmt.consequent;
  if (ret && ret.type === 'BlockStatement' && ret.body.length === 1) ret = ret.body[0];
  if (!ret || ret.type !== 'ReturnStatement') return null;
  const obj = ret.argument;
  if (!exactPropSet(obj, ['status', 'msg'])) return null;
  const status = findProp(obj, 'status');
  const msg = findProp(obj, 'msg');
  if (!status || status.value.type !== 'BooleanLiteral' || status.value.value !== false) return null;
  return {
    span: 1,
    slots: { alvo: sliceNode(ctx.source, arg.object), msg: sliceNode(ctx.source, msg.value) },
    children: {},
    variant: null,
    geracao: null,
  };
}

function matchReturn(stmt, ctx) {
  if (stmt.type !== 'ReturnStatement' || !stmt.argument || stmt.argument.type !== 'ObjectExpression') return null;
  if (!exactPropSet(stmt.argument, ['status', 'msg'])) return null;
  const status = findProp(stmt.argument, 'status');
  const msg = findProp(stmt.argument, 'msg');
  if (!status || !msg) return null;
  return {
    span: 1,
    slots: { status: sliceNode(ctx.source, status.value), msg: sliceNode(ctx.source, msg.value) },
    children: {},
    variant: null,
    geracao: null,
  };
}

function matchIf(stmt, ctx) {
  if (stmt.type !== 'IfStatement') return null;
  if (!stmt.consequent || stmt.consequent.type !== 'BlockStatement') return null;
  const entao = ctx.decomposeList(stmt.consequent.body, stmt.consequent.start + 1);
  let senao = [];
  let variant = 'se';
  if (stmt.alternate == null) {
    variant = 'se';
  } else if (stmt.alternate.type === 'BlockStatement') {
    variant = 'se-senao';
    senao = ctx.decomposeList(stmt.alternate.body, stmt.alternate.start + 1);
  } else if (stmt.alternate.type === 'IfStatement') {
    variant = 'se-senao';
    senao = ctx.decomposeList([stmt.alternate], stmt.alternate.start);
  } else {
    return null;
  }
  return {
    span: 1,
    slots: { condicao: sliceNode(ctx.source, stmt.test) },
    children: { entao, senao },
    variant,
    geracao: null,
  };
}

function walkCalls(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (node.type === 'CallExpression') acc.push(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((item) => walkCalls(item, acc));
    else if (v && typeof v === 'object' && v.type) walkCalls(v, acc);
  }
  return acc;
}

function calleeName(call) {
  const c = call.callee;
  if (!c) return null;
  if (c.type === 'Identifier') return { object: null, method: c.name };
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
    const object = c.object.type === 'Identifier' ? c.object.name : null;
    return { object, method: c.property.name };
  }
  return null;
}

function matchTryLog(stmt, ctx) {
  if (stmt.type !== 'TryStatement' || !stmt.handler || stmt.finalizer) return null;
  const calls = walkCalls(stmt.handler);
  const hasParser = calls.some((c) => {
    const n = calleeName(c);
    return n && n.object === 'ErrorStackParser' && n.method === 'parse';
  });
  const logCall = calls.find((c) => {
    const n = calleeName(c);
    return n && !n.object && n.method === 'logExeption';
  });
  if (!hasParser || !logCall) return null;
  let descricao = "''";
  const arg0 = logCall.arguments && logCall.arguments[0];
  if (arg0 && arg0.type === 'ObjectExpression') {
    const p = findProp(arg0, 'descricaoDoErro');
    if (p) descricao = sliceNode(ctx.source, p.value);
  }
  const erro = stmt.handler.param && stmt.handler.param.type === 'Identifier'
    ? stmt.handler.param.name
    : 'err';
  const corpo = ctx.decomposeList(stmt.block.body, stmt.block.start + 1);
  return {
    span: 1,
    slots: { erro, descricao },
    children: { corpo },
    variant: null,
    geracao: null,
  };
}

function isAwaitMethod(stmt, objectName, methodName, source) {
  const c = unwrapCall(stmt, source);
  return !!(c && c.await && c.object === objectName && c.method === methodName && !c.result);
}

function matchTransaction(stmts, index, ctx) {
  const decl = unwrapCall(stmts[index], ctx.source);
  if (!decl || decl.variant !== 'const-await' || decl.object !== 'knex' || decl.method !== 'transaction') return null;
  const tryStmt = stmts[index + 1];
  if (!tryStmt || tryStmt.type !== 'TryStatement' || !tryStmt.handler) return null;
  const trx = decl.result;
  const tryBody = tryStmt.block.body || [];
  const commitIdx = tryBody.findIndex((s) => isAwaitMethod(s, trx, 'commit', ctx.source));
  if (commitIdx < 0) return null;
  const catchBody = tryStmt.handler.body.body || [];
  const rbIdx = catchBody.findIndex((s) => isAwaitMethod(s, trx, 'rollback', ctx.source));
  if (rbIdx < 0) return null;
  const erro = tryStmt.handler.param && tryStmt.handler.param.type === 'Identifier'
    ? tryStmt.handler.param.name
    : 'error';
  return {
    span: 2,
    slots: { trx, erro },
    children: {
      corpo: ctx.decomposeList(tryBody.slice(0, commitIdx), tryBody[0] ? tryBody[0].start : tryStmt.block.start + 1),
      depois: ctx.decomposeList(tryBody.slice(commitIdx + 1), tryBody[commitIdx + 1] ? tryBody[commitIdx + 1].start : tryStmt.block.end),
      antesRollback: ctx.decomposeList(catchBody.slice(0, rbIdx), catchBody[0] ? catchBody[0].start : tryStmt.handler.start),
      catch: ctx.decomposeList(catchBody.slice(rbIdx + 1), catchBody[rbIdx + 1] ? catchBody[rbIdx + 1].start : tryStmt.handler.end),
    },
    variant: null,
    geracao: null,
  };
}

function matchLedger(stmts, index, ctx) {
  const n = unwrapNew(stmts[index], ctx.source);
  if (!n || !/^(Ledger|Ladger)/.test(n.ctor)) return null;
  const next = stmts[index + 1];
  const third = stmts[index + 2];
  const gravar2 = unwrapCall(next, ctx.source);
  if (gravar2 && gravar2.await && gravar2.object === n.varName && /^GravarAuditoria/.test(gravar2.method) && gravar2.variant === 'await') {
    return {
      span: 2,
      slots: {
        variavel: n.varName,
        ledger: n.ctor,
        argumento: n.args,
        metodo: gravar2.method,
        payload: gravar2.args,
        inicial: '',
      },
      children: {},
      variant: 'direto',
      geracao: null,
    };
  }
  const init = unwrapCall(next, ctx.source);
  const gravar3 = unwrapCall(third, ctx.source);
  if (
    init && !init.await && init.object === n.varName && init.method === 'Initialize' && init.variant === 'expr'
    && gravar3 && gravar3.await && gravar3.object === n.varName && /^GravarAuditoria/.test(gravar3.method) && gravar3.variant === 'await'
  ) {
    return {
      span: 3,
      slots: {
        variavel: n.varName,
        ledger: n.ctor,
        argumento: n.args,
        metodo: gravar3.method,
        payload: gravar3.args,
        inicial: init.args,
      },
      children: {},
      variant: 'com-initialize',
      geracao: null,
    };
  }
  return null;
}

function matchPublish(stmts, index, ctx) {
  const n = unwrapNew(stmts[index], ctx.source);
  if (!n || n.ctor !== 'MessageDispatcher') return null;
  const add = unwrapCall(stmts[index + 1], ctx.source);
  const disp = unwrapCall(stmts[index + 2], ctx.source);
  if (!add || add.await || add.object !== n.varName || add.method !== 'addItem' || add.variant !== 'expr') return null;
  if (!disp || !disp.await || disp.object !== n.varName || disp.method !== 'dispatch' || disp.variant !== 'await') return null;
  return {
    span: 3,
    slots: { variavel: n.varName, argumentos: n.args, item: add.args },
    children: {},
    variant: 'dispatcher',
    geracao: null,
  };
}

function matchKind(pattern, stmts, index, ctx) {
  const stmt = stmts[index];
  switch (pattern.kind) {
    case 'call':
      return matchCall(stmt, pattern, ctx);
    case 'new':
      return matchNew(stmt, pattern, ctx);
    case 'guard':
      return matchGuard(stmt, ctx);
    case 'return-status':
      return matchReturn(stmt, ctx);
    case 'if-else':
      return matchIf(stmt, ctx);
    case 'try-log':
      return matchTryLog(stmt, ctx);
    case 'transaction':
      return index + 1 < stmts.length ? matchTransaction(stmts, index, ctx) : null;
    case 'ledger':
      return matchLedger(stmts, index, ctx);
    case 'publish':
      return index + 2 < stmts.length ? matchPublish(stmts, index, ctx) : null;
    default:
      return null;
  }
}

function matchNode(node, pattern, ctx) {
  if (pattern == null) return node == null;
  if (typeof pattern !== 'object') return node === pattern;
  if (pattern.$any) return true;
  if (pattern.$optional && node == null) return true;
  if (pattern.$container) {
    if (!node || node.type !== 'BlockStatement') return false;
    ctx.children[pattern.$container] = ctx.decomposeList(node.body, node.start + 1);
    return true;
  }
  if (pattern.$bind) {
    if (node == null) return false;
    if (pattern.type && node.type !== pattern.type) return false;
    if (pattern.$as === 'expr' && !isExpression(node)) return false;
    if (pattern.$match) {
      const re = regex(pattern.$match);
      if (node.type !== 'Identifier' || !re || !re.test(node.name)) return false;
    }
    if (pattern.name && !(node.type === 'Identifier' && node.name === pattern.name)) return false;
    ctx.slots[pattern.$bind] = sliceNode(ctx.source, node);
    return true;
  }
  if (Array.isArray(pattern)) {
    if (!Array.isArray(node) || node.length !== pattern.length) return false;
    return pattern.every((p, i) => matchNode(node[i], p, ctx));
  }
  if (!node || typeof node !== 'object') return false;
  if (pattern.type && node.type !== pattern.type) return false;
  for (const [k, v] of Object.entries(pattern)) {
    if (k === 'type' || k === 'variant' || k === 'template' || k === 'priority' || k === 'geracao') continue;
    if (k === 'kind' && DSL_KINDS.has(v)) continue;
    if (k.startsWith('$')) continue;
    if (!matchNode(node[k], v, ctx)) return false;
  }
  return true;
}

function countConstraints(pattern) {
  if (!pattern || typeof pattern !== 'object') return 0;
  let n = 0;
  if (pattern.type) n += 1;
  if (pattern.kind) n += 3;
  for (const [k, v] of Object.entries(pattern)) {
    if (k === 'variant' || k === 'template' || k === 'geracao') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') n += 1;
    else if (v && typeof v === 'object') n += countConstraints(v);
  }
  return n;
}

function matchAst(pattern, stmts, index, ctx) {
  const seq = pattern.sequence || [pattern];
  if (!Array.isArray(seq) || index + seq.length > stmts.length) return null;
  const slots = {};
  const children = {};
  const local = {
    source: ctx.source,
    slots,
    children,
    decomposeList: ctx.decomposeList,
    slice: (node) => sliceNode(ctx.source, node),
  };
  for (let i = 0; i < seq.length; i += 1) {
    if (!matchNode(stmts[index + i], seq[i], local)) return null;
  }
  return {
    span: seq.length,
    slots,
    children,
    variant: pattern.variant || null,
    geracao: pattern.geracao || null,
    template: pattern.template || null,
    constraints: countConstraints(pattern),
  };
}

const DSL_KINDS = new Set(['call', 'new', 'guard', 'return-status', 'if-else', 'try-log', 'transaction', 'ledger', 'publish']);

function matchOne(pattern, stmts, index, ctx) {
  if (!pattern || typeof pattern !== 'object') return null;
  // `kind: "const"` e campo de AST (VariableDeclaration), nao o DSL.
  if (pattern.kind && DSL_KINDS.has(pattern.kind) && !pattern.type && !pattern.sequence) {
    const m = matchKind(pattern, stmts, index, ctx);
    if (!m) return null;
    return {
      ...m,
      template: pattern.template || null,
      constraints: countConstraints(pattern),
      variant: m.variant || pattern.variant || null,
      geracao: m.geracao || pattern.geracao || null,
    };
  }
  if (pattern.sequence || pattern.type || pattern.$bind) return matchAst(pattern, stmts, index, ctx);
  return null;
}

function matchBlock(block, stmts, index, ctx) {
  const patterns = Array.isArray(block.pattern) ? block.pattern : block.pattern ? [block.pattern] : [];
  let best = null;
  for (const p of patterns) {
    const m = matchOne(p, stmts, index, ctx);
    if (!m) continue;
    const score = (block.priority || 0) * 100 + m.span * 10 + (m.constraints || 0) + ((p && p.priority) || 0);
    if (!best || score > best.score) {
      best = {
        ...m,
        score,
        imports: (p && p.imports) || null,
        templateOverride: (p && p.template) || null,
        geracao: m.geracao || block.geracao || null,
      };
    }
  }
  return best;
}

module.exports = {
  matchBlock,
  sliceNode,
  unwrapCall,
  unwrapNew,
};
