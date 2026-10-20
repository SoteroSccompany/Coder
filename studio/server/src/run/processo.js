'use strict';

/**
 * Liga o node do projeto, aciona HTTP, voa um metodo com marcos
 * e cruza o stack do Jest com o loc do fluxo.
 * O spawn segue o de infra/operacao.js: argumentos em array, sem shell.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const { HttpError } = require('../util/httpError');
const { runProcess } = require('../infra/operacao');

const METODOS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const PREFIXO = '__STUDIO_TRACE__';
const TIMEOUT_VOO = 20000;
const TIMEOUT_JEST = 120000;
const TIMEOUT_HTTP = 10000;

const RUNNER = `'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

let atual = null;
let t0 = 0;

function emitir(passo) {
  fs.writeSync(1, '${PREFIXO}' + JSON.stringify(passo) + '\\n');
}

global.__studioMarco = function (index) {
  const agora = Date.now();
  if (atual != null) {
    emitir({ index: atual, ok: true, ms: Math.max(0, agora - t0) });
  }
  atual = index;
  t0 = agora;
};

function fim(erro) {
  if (atual == null) return;
  const passo = { index: atual, ok: !erro, ms: Math.max(0, Date.now() - t0) };
  if (erro) passo.error = String(erro);
  emitir(passo);
  atual = null;
}

function mensagem(err) {
  if (!err) return 'erro';
  if (typeof err === 'string') return err;
  if (err && err.message) return String(err.message);
  return String(err);
}

const original = process.env.STUDIO_VOO_ORIGINAL;
const copia = process.env.STUDIO_VOO_COPIA;
const method = process.env.STUDIO_VOO_METHOD;
const className = process.env.STUDIO_VOO_CLASS || '';
const estatico = process.env.STUDIO_VOO_STATIC === '1';
const input = JSON.parse(process.env.STUDIO_VOO_INPUT || 'null');
const fonte = fs.readFileSync(copia, 'utf8');

let alvoCompilado;
try {
  const m = new Module(original);
  m.filename = original;
  m.paths = Module._nodeModulePaths(path.dirname(original));
  m._compile(fonte, original);
  alvoCompilado = m.exports;
} catch (err) {
  fs.writeSync(2, mensagem(err) + '\\n');
  process.exit(1);
}

function escolher(exp) {
  if (className && exp && typeof exp !== 'function' && typeof exp[className] === 'function') return exp[className];
  if (typeof exp === 'function') return exp;
  if (exp && typeof exp === 'object') {
    const funcoes = Object.values(exp).filter((v) => typeof v === 'function');
    if (funcoes.length === 1) return funcoes[0];
  }
  return null;
}

(async () => {
  try {
    const Alvo = escolher(alvoCompilado);
    if (!Alvo) throw new Error('Classe nao encontrada');
    let promessa;
    if (estatico) {
      if (typeof Alvo[method] !== 'function') throw new Error('Metodo nao encontrado');
      promessa = Alvo[method](input);
    } else if (typeof Alvo === 'function' && Alvo.prototype && typeof Alvo.prototype[method] === 'function') {
      promessa = new Alvo()[method](input);
    } else if (typeof Alvo[method] === 'function') {
      promessa = Alvo[method](input);
    } else {
      throw new Error('Metodo nao encontrado');
    }
    await promessa;
    fim(null);
  } catch (err) {
    const tinha = atual != null;
    fim(mensagem(err));
    if (!tinha) {
      fs.writeSync(2, mensagem(err) + '\\n');
      process.exitCode = 1;
    }
  }
})();
`;

function portaDo(ctx) {
  const manifesto = ctx.manifest && ctx.manifest.port;
  const bruto = manifesto != null && manifesto !== '' ? manifesto : process.env.PORT;
  const porta = Number(bruto);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw HttpError.badRequest('PORTA_AUSENTE', 'Defina port (1-65535) no studio.project.json ou a variavel PORT');
  }
  return porta;
}

function vivo(reg) {
  return !!(reg && reg.child && reg.child.exitCode == null && !reg.child.killed);
}

function matar(child) {
  if (!child || child.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ja encerrou */ }
    }, 1500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

function lerLinhas(child, onLine) {
  const resto = { stdout: '', stderr: '' };
  const tomar = (stream, pedaco) => {
    resto[stream] += pedaco.toString();
    if (resto[stream].length > 200000) resto[stream] = resto[stream].slice(-200000);
    const partes = resto[stream].split(/\r?\n/);
    resto[stream] = partes.pop();
    for (const line of partes) onLine(stream, line);
  };
  if (child.stdout) child.stdout.on('data', (d) => tomar('stdout', d));
  if (child.stderr) child.stderr.on('data', (d) => tomar('stderr', d));
  child.on('exit', () => {
    if (resto.stdout) onLine('stdout', resto.stdout);
    if (resto.stderr) onLine('stderr', resto.stderr);
  });
}

function portaAberta(porta) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: porta, host: '127.0.0.1' });
    const fim = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(250);
    socket.once('connect', () => fim(true));
    socket.once('timeout', () => fim(false));
    socket.once('error', () => fim(false));
  });
}

function esperarPorta(porta, child, ms) {
  const limite = Date.now() + ms;
  const passo = () => new Promise((r) => setTimeout(r, 40));
  const loop = async () => {
    while (Date.now() < limite) {
      if (child.exitCode != null || child.killed) return false;
      if (await portaAberta(porta)) return true;
      await passo();
    }
    return child.exitCode == null && await portaAberta(porta);
  };
  return loop();
}

function instrumentar(source, blocos) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const marcas = [];
  (blocos || []).forEach((bloco, index) => {
    const line = bloco && bloco.loc && bloco.loc.start && bloco.loc.start.line;
    if (!Number.isInteger(line) || line < 1) return;
    marcas.push({ index, line });
  });
  marcas.sort((a, b) => b.line - a.line || b.index - a.index);
  for (const marca of marcas) {
    const i = marca.line - 1;
    if (i < 0 || i >= lines.length) continue;
    const indent = (lines[i].match(/^[ \t]*/) || [''])[0];
    lines.splice(i, 0, `${indent}global.__studioMarco(${marca.index});`);
  }
  return lines.join(eol);
}

function foraDoProjeto(dir, root) {
  const realDir = fs.realpathSync(dir);
  const realRoot = fs.realpathSync(root);
  const rel = path.relative(realRoot, realDir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error('Copia temporaria caiu dentro do projeto');
  }
  const base = fs.realpathSync(os.tmpdir());
  const noTmp = path.relative(base, realDir);
  if (noTmp.startsWith('..') || path.isAbsolute(noTmp)) {
    throw new Error('Copia temporaria fora do diretorio temporario');
  }
}

function extrairPassos(buffer) {
  const passos = [];
  const partes = buffer.split(/\r?\n/);
  const resto = partes.pop();
  for (const line of partes) {
    const i = line.indexOf(PREFIXO);
    if (i < 0) continue;
    try {
      const passo = JSON.parse(line.slice(i + PREFIXO.length));
      if (passo && Number.isInteger(passo.index)) passos.push(passo);
    } catch {
      /* linha de log do proprio metodo */
    }
  }
  return { passos, resto: resto || '' };
}

function executarArquivo(arquivo, env, cwd, onPasso, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [arquivo], {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: 127, stdout: '', stderr: err.message, passos: [], timeout: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let pendente = '';
    const passos = [];
    let timeout = false;
    const consumir = (texto) => {
      const extraido = extrairPassos(pendente + texto);
      pendente = extraido.resto;
      for (const passo of extraido.passos) {
        passos.push(passo);
        if (onPasso) onPasso(passo);
      }
    };
    const timer = setTimeout(() => {
      timeout = true;
      try { child.kill('SIGKILL'); } catch { /* ja encerrou */ }
    }, timeoutMs);
    let settled = false;
    const acabar = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendente) consumir(`${pendente}\n`);
      resolve({ code: code ?? 1, stdout, stderr, passos, timeout });
    };
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout = (stdout + s).slice(-200000);
      consumir(s);
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-200000);
    });
    child.on('error', (err) => {
      stderr = (stderr + (err && err.message ? err.message : '')).slice(-200000);
      acabar(127);
    });
    child.on('close', (code) => acabar(code));
  });
}

function quadrosDoStack(texto) {
  const out = [];
  const re = /((?:[A-Za-z]:)?[^:\s()'"<>]+\.js):(\d+):\d+/g;
  let m;
  const fonte = String(texto || '');
  while ((m = re.exec(fonte))) out.push({ file: m[1], line: Number(m[2]) });
  return out;
}

function quadrosNoProjeto(ctx, texto) {
  const root = fs.realpathSync(ctx.rootPath);
  const vistos = [];
  for (const q of quadrosDoStack(texto)) {
    if (q.file.includes('node_modules')) continue;
    let abs = path.isAbsolute(q.file) ? q.file : path.resolve(root, q.file);
    try {
      abs = fs.realpathSync(abs);
    } catch {
      continue;
    }
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!rel || rel.startsWith('..') || rel.includes('node_modules')) continue;
    vistos.push({ rel, abs, line: q.line });
  }
  return vistos;
}

function eUseCase(ctx, rel) {
  const layer = typeof ctx.layerOf === 'function' ? ctx.layerOf(rel) : null;
  if (layer && layer.id === 'usecase') return true;
  return /(^|\/)usecase(\/|$)/i.test(rel);
}

/** Placa de topo cujo loc contem a linha. O indice e o da lista do metodo. */
function placaNaLinha(methods, line) {
  let melhor = null;
  for (const m of methods || []) {
    (m.blocks || []).forEach((bloco, index) => {
      const loc = bloco && bloco.loc;
      if (!loc || !loc.start || !loc.end) return;
      if (line < loc.start.line || line > loc.end.line) return;
      const span = loc.end.line - loc.start.line;
      if (!melhor || span < melhor.span) melhor = { line, index, span };
    });
  }
  if (!melhor) return null;
  return { line: melhor.line, index: melhor.index };
}

function pedirHttp({ porta, method, caminho, body }) {
  const inicio = Date.now();
  const enviar = method !== 'GET' && method !== 'HEAD' && body != null;
  const dados = !enviar ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = {};
  if (dados) {
    headers['content-type'] = typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8';
    headers['content-length'] = String(dados.length);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: porta,
      method,
      path: caminho,
      headers,
      timeout: TIMEOUT_HTTP,
    }, (res) => {
      const chunks = [];
      let tamanho = 0;
      res.on('data', (d) => {
        tamanho += d.length;
        if (tamanho <= 1000000) chunks.push(d);
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          ms: Date.now() - inicio,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado')));
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

function createProcesso(deps) {
  const processos = new Map();
  const { hub, files } = deps;

  function blocos() {
    if (!deps.ext.blocks) throw new Error('Servico de blocos indisponivel');
    return deps.ext.blocks;
  }

  async function ligar(ctx) {
    const atual = processos.get(ctx.id);
    if (vivo(atual)) {
      return { ok: true, url: atual.url, porta: atual.porta, pid: atual.child.pid };
    }
    const porta = portaDo(ctx);
    const entrada = (ctx.manifest && ctx.manifest.entry) || 'index.js';
    const { abs } = ctx.resolvePath(entrada);
    if (!fs.existsSync(abs)) {
      throw HttpError.notFound('ENTRY_AUSENTE', `${entrada} nao encontrado`);
    }
    let stderr = '';
    const child = spawn(process.execPath, [entrada], {
      cwd: ctx.rootPath,
      env: { ...process.env, PORT: String(porta) },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const registro = {
      child,
      porta,
      url: `http://127.0.0.1:${porta}`,
    };
    processos.set(ctx.id, registro);
    lerLinhas(child, (stream, line) => {
      if (stream === 'stderr') stderr = (stderr + line).slice(-2000);
      if (hub) hub.publish(ctx.id, 'run:log', { stream, line });
    });
    child.on('exit', () => {
      if (processos.get(ctx.id) === registro) processos.delete(ctx.id);
    });
    let abriu = false;
    try {
      abriu = await esperarPorta(porta, child, 4000);
    } catch (err) {
      await matar(child);
      if (processos.get(ctx.id) === registro) processos.delete(ctx.id);
      throw err;
    }
    if (!abriu || !vivo(registro)) {
      await matar(child);
      if (processos.get(ctx.id) === registro) processos.delete(ctx.id);
      throw new HttpError(409, 'PROCESSO_FALHOU', stderr.trim() || 'O processo nao abriu a porta');
    }
    return { ok: true, url: registro.url, porta, pid: child.pid };
  }

  async function desligar(ctx) {
    const atual = processos.get(ctx.id);
    processos.delete(ctx.id);
    if (!atual) return { ok: true };
    await matar(atual.child);
    return { ok: true, pid: atual.child.pid };
  }

  async function acionar(ctx, body) {
    const atual = processos.get(ctx.id);
    if (!vivo(atual)) throw new HttpError(409, 'PROCESSO_PARADO', 'Nenhum processo ligado neste projeto');
    const method = String((body && body.method) || 'GET').toUpperCase();
    if (!METODOS.has(method)) throw HttpError.badRequest('METODO_INVALIDO', 'Metodo HTTP invalido');
    const caminho = body && body.path;
    if (typeof caminho !== 'string' || !caminho.startsWith('/') || caminho.startsWith('//') || /[\r\n\0]/.test(caminho)) {
      throw HttpError.badRequest('CAMINHO_INVALIDO', 'Informe um path que comece com /');
    }
    try {
      return await pedirHttp({ porta: atual.porta, method, caminho, body: body.body });
    } catch (err) {
      return { status: 0, body: err.message || 'Falha ao acionar', ms: 0 };
    }
  }

  async function voo(ctx, body) {
    const caminho = body && body.path;
    const method = body && body.method;
    const className = body && body.className ? String(body.className) : '';
    if (typeof caminho !== 'string' || !caminho.trim()) {
      throw HttpError.badRequest('PATH_REQUIRED', 'Informe o path do arquivo');
    }
    if (typeof method !== 'string' || !method.trim()) {
      throw HttpError.badRequest('METHOD_REQUIRED', 'Informe o metodo');
    }
    const arquivo = await files.readFile(ctx, caminho);
    const antes = arquivo.content;
    const fluxo = blocos().decompose(antes, ctx);
    const alvos = fluxo.methods.filter((m) => m.name === method && (!className || m.className === className));
    if (!alvos.length) throw HttpError.notFound('METHOD_NOT_FOUND', `Metodo nao encontrado: ${method}`);
    if (alvos.length > 1) throw HttpError.badRequest('CLASSE_AMBIGUA', 'Ha mais de uma classe com esse metodo. Informe className');
    const alvo = alvos[0];
    const { abs } = ctx.resolvePath(arquivo.path);
    let entrada;
    try {
      entrada = JSON.stringify(body.input === undefined ? null : body.input);
    } catch {
      throw HttpError.badRequest('INPUT_INVALIDO', 'input nao serializavel');
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-voo-'));
    try {
      foraDoProjeto(dir, ctx.rootPath);
      const copia = path.join(dir, 'metodo.js');
      const runner = path.join(dir, 'runner.js');
      fs.writeFileSync(copia, instrumentar(antes, alvo.blocks), 'utf8');
      fs.writeFileSync(runner, RUNNER, 'utf8');
      const resultado = await executarArquivo(runner, {
        ...process.env,
        STUDIO_VOO_ORIGINAL: abs,
        STUDIO_VOO_COPIA: copia,
        STUDIO_VOO_METHOD: alvo.name,
        STUDIO_VOO_CLASS: alvo.className || className || '',
        STUDIO_VOO_STATIC: alvo.static ? '1' : '0',
        STUDIO_VOO_INPUT: entrada,
      }, ctx.rootPath, (passo) => {
        if (hub) hub.publish(ctx.id, 'run:trace', passo);
      }, TIMEOUT_VOO);
      if (fs.readFileSync(abs, 'utf8') !== antes) {
        throw new Error('O voo alterou o arquivo do projeto');
      }
      if (resultado.timeout) {
        throw new HttpError(504, 'VOO_TIMEOUT', 'Tempo esgotado no voo', { passos: resultado.passos });
      }
      if (!resultado.passos.length && resultado.code !== 0) {
        throw new HttpError(500, 'VOO_FALHOU', (resultado.stderr || 'Falha ao executar o voo').trim().slice(0, 800));
      }
      return { passos: resultado.passos };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async function testar(ctx, body) {
    const runner = deps.ext.runRunner || runProcess;
    const resultado = await runner('npx', ['jest', '--forceExit'], {
      cwd: ctx.rootPath,
      timeoutMs: TIMEOUT_JEST,
    });
    const texto = `${resultado.stdout || ''}\n${resultado.stderr || ''}`;
    const placa = await cruzar(ctx, texto, body && body.path);
    return {
      ok: resultado.code === 0,
      code: resultado.code ?? 1,
      stdout: resultado.stdout || '',
      stderr: resultado.stderr || '',
      placa,
    };
  }

  async function cruzar(ctx, texto, caminho) {
    const quadros = quadrosNoProjeto(ctx, texto);
    let escolhido = null;
    if (caminho) {
      let real;
      try {
        real = fs.realpathSync(ctx.resolvePath(caminho).abs);
      } catch {
        return null;
      }
      escolhido = quadros.find((q) => q.abs === real) || null;
    } else {
      const casos = quadros.filter((q) => eUseCase(ctx, q.rel));
      escolhido = casos[0] || null;
    }
    if (!escolhido) return null;
    let arquivo;
    try {
      arquivo = await files.readFile(ctx, escolhido.rel);
    } catch {
      return null;
    }
    let fluxo;
    try {
      fluxo = blocos().decompose(arquivo.content, ctx);
    } catch {
      return null;
    }
    return placaNaLinha(fluxo.methods, escolhido.line);
  }

  return {
    ligar,
    desligar,
    acionar,
    voo,
    testar,
    placaNaLinha,
    quadrosDoStack,
  };
}

module.exports = {
  createProcesso,
  instrumentar,
  placaNaLinha,
  quadrosDoStack,
};
