'use strict';

/**
 * Tabela de rotas: le router.METODO em infrastructure/routes e garante um handler
 * minimo no controller quando o metodo ainda nao existe.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const recast = require('recast');
const traverse = require('@babel/traverse').default;
const { parseFile, print, listClassMethods } = require('../services/astService');
const { HttpError } = require('../util/httpError');
const { layerBase, assertNaCamada, relRequire, exigirIdent } = require('./caminhos');

const METODOS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function methodKey(m) {
  if (!m || !m.key) return null;
  if (m.key.type === 'Identifier') return m.key.name;
  if (m.key.type === 'StringLiteral') return m.key.value;
  return null;
}

function descreverHandler(arg) {
  if (!arg) return null;
  if (arg.type === 'MemberExpression' && !arg.computed && arg.object.type === 'Identifier' && arg.property.type === 'Identifier') {
    return `${arg.object.name}.${arg.property.name}`;
  }
  if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') return '(inline)';
  if (arg.type === 'Identifier') return arg.name;
  return null;
}

function extrairRotas(source) {
  const ast = parseFile(source);
  const rotas = [];
  traverse(ast, {
    noScope: true,
    CallExpression(p) {
      const c = p.node;
      if (c.callee.type !== 'MemberExpression' || c.callee.computed) return;
      if (c.callee.object.type !== 'Identifier' || c.callee.property.type !== 'Identifier') return;
      const method = c.callee.property.name.toLowerCase();
      if (!METODOS.has(method)) return;
      const caminho = c.arguments.find((a) => a.type === 'StringLiteral');
      if (!caminho) return;
      const ultimo = c.arguments[c.arguments.length - 1];
      rotas.push({
        router: c.callee.object.name,
        method,
        path: caminho.value,
        handler: descreverHandler(ultimo),
      });
    },
  });
  return rotas;
}

async function listarJs(ctx, layerId) {
  const base = layerBase(ctx, layerId);
  let startAbs;
  let startRel;
  try {
    const resolved = ctx.resolvePath(base);
    startAbs = resolved.abs;
    startRel = resolved.rel;
  } catch (err) {
    if (err instanceof HttpError) return [];
    throw err;
  }
  const acc = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return;
      throw err;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = `${rel}/${e.name}`;
      if (ctx.isIgnored(childRel)) continue;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) await walk(childAbs, childRel);
      else if (e.isFile() && e.name.endsWith('.js')) acc.push(childRel);
    }
  }
  if (!fs.existsSync(startAbs)) return [];
  await walk(startAbs, startRel);
  return acc;
}

async function lerRotasProjeto(ctx, files) {
  const arquivosRotas = await listarJs(ctx, 'routes');
  const arquivosCtrl = await listarJs(ctx, 'controller');
  const arquivos = {};
  const rotas = [];
  const erros = [];
  for (const file of arquivosRotas) {
    let doc;
    try {
      doc = await files.readFile(ctx, file);
    } catch (err) {
      erros.push({ file, error: err.message });
      continue;
    }
    arquivos[file] = { hash: doc.hash };
    try {
      for (const r of extrairRotas(doc.content)) rotas.push({ file, ...r });
    } catch (err) {
      erros.push({ file, error: err.message });
    }
  }
  const controllers = [];
  for (const file of arquivosCtrl) {
    let doc;
    try {
      doc = await files.readFile(ctx, file);
    } catch (err) {
      erros.push({ file, error: err.message });
      continue;
    }
    arquivos[file] = { hash: doc.hash };
    try {
      const ast = parseFile(doc.content);
      const metodos = listClassMethods(ast).filter((m) => m.kind === 'method').map((m) => m.name);
      const className = listClassMethods(ast).find((m) => m.className)?.className || null;
      controllers.push({ file, className, metodos });
    } catch (err) {
      erros.push({ file, error: err.message });
    }
  }
  return { rotas, controllers, arquivos, erros };
}

function validarCaminho(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.length > 200) {
    throw HttpError.badRequest('CAMINHO_INVALIDO', 'O caminho da rota deve comecar com /');
  }
  if (/[\r\n\0]/.test(p) || p.includes('..')) {
    throw HttpError.badRequest('CAMINHO_INVALIDO', 'Caminho de rota invalido');
  }
  return p;
}

function partirHandler(handler) {
  if (typeof handler !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(handler)) {
    throw HttpError.badRequest('HANDLER_INVALIDO', 'Handler deve ser Controlador.metodo');
  }
  const [obj, met] = handler.split('.');
  exigirIdent(obj, 'Controller');
  exigirIdent(met, 'Metodo');
  return { obj, met };
}

function casaChamada(node, { method, routePath, handler }) {
  if (!node || node.type !== 'CallExpression') return false;
  const c = node.callee;
  if (!c || c.type !== 'MemberExpression' || c.computed) return false;
  if (c.property.type !== 'Identifier' || c.property.name.toLowerCase() !== method) return false;
  const caminho = node.arguments.find((a) => a.type === 'StringLiteral');
  if (!caminho || caminho.value !== routePath) return false;
  const ultimo = node.arguments[node.arguments.length - 1];
  const desc = descreverHandler(ultimo);
  if (handler && desc !== handler) return false;
  return true;
}

function nomeRouter(ast) {
  let nome = null;
  traverse(ast, {
    noScope: true,
    VariableDeclarator(p) {
      if (nome) return;
      if (p.node.id.type === 'Identifier' && p.node.id.name === 'router') nome = 'router';
    },
  });
  return nome || 'router';
}

function temDeclaracao(ast, nome) {
  let achou = false;
  traverse(ast, {
    noScope: true,
    VariableDeclarator(p) {
      if (p.node.id.type === 'Identifier' && p.node.id.name === nome) achou = true;
    },
    FunctionDeclaration(p) {
      if (p.node.id && p.node.id.name === nome) achou = true;
    },
  });
  return achou;
}

function inserirRequire(ast, local, modulo) {
  if (temDeclaracao(ast, local)) return false;
  const stmt = parseFile(`const ${local} = require(${JSON.stringify(modulo)});`).program.body[0];
  let ultimo = -1;
  ast.program.body.forEach((n, i) => {
    if (recast.print(n).code.includes('require(')) ultimo = i;
  });
  ast.program.body.splice(ultimo + 1, 0, stmt);
  return true;
}

function adicionarRota(source, { method, routePath, handler, requirePath }) {
  const ast = parseFile(source);
  const ja = extrairRotas(source).some((r) => r.method === method && r.path === routePath && r.handler === handler);
  if (ja) return { source, criada: false };
  const { obj, met } = partirHandler(handler);
  const router = nomeRouter(ast);
  const stmt = parseFile(`${router}.${method}(${JSON.stringify(routePath)}, ${obj}.${met});`).program.body[0];
  if (requirePath) inserirRequire(ast, obj, requirePath);
  ast.program.body.push(stmt);
  return { source: print(ast), criada: true };
}

function removerRota(source, { method, routePath, handler }) {
  const ast = parseFile(source);
  const alvos = [];
  traverse(ast, {
    noScope: true,
    ExpressionStatement(p) {
      if (casaChamada(p.node.expression, { method, routePath, handler })) alvos.push(p);
    },
  });
  if (alvos.length === 0) throw HttpError.notFound('ROTA_NAO_ENCONTRADA', 'Rota nao encontrada nesse arquivo');
  alvos.forEach((p) => p.remove());
  return print(ast);
}

function garantirHandler(source, nomeMetodo) {
  exigirIdent(nomeMetodo, 'Metodo do controller');
  const ast = parseFile(source);
  let classPath = null;
  traverse(ast, {
    noScope: true,
    Class(p) {
      if (!classPath) classPath = p;
    },
  });
  if (!classPath) throw new HttpError(422, 'SEM_CLASSE', 'Controller sem classe');
  const existe = classPath.node.body.body.some((m) => methodKey(m) === nomeMetodo);
  if (existe) return { source, criado: false };
  const wrapper = parseFile(
    `class T {\n    async ${nomeMetodo}(req, res) {\n        res.status(200).json({ status: true, msg: 'ok' });\n    }\n}\n`,
  );
  classPath.node.body.body.push(wrapper.program.body[0].body.body[0]);
  return { source: print(ast), criado: true };
}

function acharController(ctx, arquivosCtrl, nomeController, controllerPath) {
  if (controllerPath) {
    assertNaCamada(ctx, controllerPath, 'controller');
    return controllerPath;
  }
  const direto = arquivosCtrl.find((f) => f.endsWith(`/${nomeController}.js`) || f.endsWith(`${nomeController}.js`));
  return direto || null;
}

async function salvarRota(ctx, files, body) {
  const action = body && body.action;
  if (action !== 'add' && action !== 'remove') {
    throw HttpError.badRequest('ACAO_INVALIDA', 'action deve ser add ou remove');
  }
  const file = body.file;
  if (typeof file !== 'string') throw HttpError.badRequest('ARQUIVO_OBRIGATORIO', 'Informe o arquivo de rotas');
  assertNaCamada(ctx, file, 'routes');
  const method = String(body.method || '').toLowerCase();
  if (!METODOS.has(method)) throw HttpError.badRequest('METODO_INVALIDO', 'Metodo HTTP invalido');
  const routePath = validarCaminho(body.path);
  const handler = body.handler === '(inline)' ? '(inline)' : partirHandler(body.handler) && body.handler;
  if (typeof body.baseHash !== 'string') {
    throw HttpError.badRequest('BASE_HASH_REQUIRED', 'baseHash do arquivo de rotas e obrigatorio');
  }

  const atual = await files.readFile(ctx, file);
  let controllerPath = null;
  let controllerHash = null;
  let handlerCriado = false;

  if (action === 'remove') {
    const next = removerRota(atual.content, { method, routePath, handler });
    const gravado = await files.writeFile(ctx, file, next, body.baseHash);
    return { ...gravado, criada: false, removida: true, handlerCriado: false };
  }

  const { obj, met } = partirHandler(handler);
  const controllers = await listarJs(ctx, 'controller');
  controllerPath = acharController(ctx, controllers, obj, body.controllerPath || null);
  let requirePath = null;
  if (controllerPath) {
    requirePath = relRequire(file, controllerPath.replace(/\.js$/, ''));
    const ctrl = await files.readFile(ctx, controllerPath);
    const garantido = garantirHandler(ctrl.content, met);
    if (garantido.criado) {
      if (typeof body.controllerBaseHash !== 'string') {
        throw HttpError.badRequest('BASE_HASH_REQUIRED', 'controllerBaseHash e obrigatorio para criar o handler');
      }
      const gravadoCtrl = await files.writeFile(ctx, controllerPath, garantido.source, body.controllerBaseHash);
      controllerHash = gravadoCtrl.hash;
      handlerCriado = true;
    } else {
      controllerHash = ctrl.hash;
    }
  }

  const adicionada = adicionarRota(atual.content, { method, routePath, handler, requirePath });
  if (!adicionada.criada) {
    return {
      path: atual.path,
      hash: atual.hash,
      criada: false,
      removida: false,
      handlerCriado,
      controllerPath,
      controllerHash,
    };
  }
  const gravado = await files.writeFile(ctx, file, adicionada.source, body.baseHash);
  return {
    ...gravado,
    criada: true,
    removida: false,
    handlerCriado,
    controllerPath,
    controllerHash,
    aviso: controllerPath ? undefined : 'Controller nao encontrado; a rota foi acrescentada sem criar handler',
  };
}

module.exports = {
  extrairRotas,
  listarJs,
  lerRotasProjeto,
  salvarRota,
  garantirHandler,
  adicionarRota,
  removerRota,
};
