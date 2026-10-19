'use strict';

/**
 * Comandos de operacao (docker compose, npm, healthcheck).
 * Argumentos vao em array — nada de shell nem de concatenar input do usuario.
 * O runner real pode ser trocado por deps.ext.infraRunner nos testes.
 */

const { spawn } = require('child_process');
const http = require('http');
const { HttpError } = require('../util/httpError');

const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const SERVICO = /^[a-z0-9][a-z0-9_-]{0,40}$/;

function slugDo(ctx) {
  const s = String(ctx.id || '').toLowerCase();
  if (!SLUG.test(s)) throw HttpError.badRequest('SLUG_INVALIDO', 'Id de projeto invalido para o compose');
  return s;
}

function servicoOpcional(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const s = String(valor);
  if (!SERVICO.test(s)) throw HttpError.badRequest('SERVICO_INVALIDO', 'Nome de servico invalido');
  return s;
}

function cauda(valor) {
  const n = Number.parseInt(String(valor ?? ''), 10);
  if (!Number.isInteger(n) || n < 1) return 100;
  return Math.min(n, 500);
}

function argsCompose(slug, arquivo, extra) {
  return ['compose', '-p', slug, '-f', arquivo, ...extra];
}

function argsUp(slug, arquivo, servico) {
  const extra = ['up', '-d'];
  if (servico) extra.push(servico);
  return { cmd: 'docker', args: argsCompose(slug, arquivo, extra), timeoutMs: 120000 };
}

function argsDown(slug, arquivo) {
  return { cmd: 'docker', args: argsCompose(slug, arquivo, ['down']), timeoutMs: 60000 };
}

function argsLogs(slug, arquivo, tail, servico) {
  const extra = ['logs', '--tail', String(tail)];
  if (servico) extra.push(servico);
  return { cmd: 'docker', args: argsCompose(slug, arquivo, extra), timeoutMs: 20000 };
}

function argsNpm(prefixo, script) {
  if (script !== 'migrate' && script !== 'test') {
    throw HttpError.badRequest('SCRIPT_INVALIDO', 'Script nao permitido');
  }
  if (script === 'migrate') {
    return { cmd: 'npm', args: ['--prefix', prefixo, 'run', 'migrate'], timeoutMs: 180000 };
  }
  return {
    cmd: 'npm',
    args: ['--prefix', prefixo, 'exec', '--', 'jest', '--passWithNoTests', '--forceExit'],
    timeoutMs: 180000,
  };
}

function runProcess(cmd, args, { cwd, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (resultado) => {
      if (settled) return;
      settled = true;
      resolve(resultado);
    };
    let child;
    try {
      child = spawn(cmd, args, { cwd, shell: false, env: process.env, windowsHide: true });
    } catch (err) {
      finish({ code: 127, stdout: '', stderr: err.message, error: err.code || 'SPAWN' });
      return;
    }
    let stdout = '';
    let stderr = '';
    const cortar = (texto) => (texto.length > 200000 ? texto.slice(-200000) : texto);
    const timer = setTimeout(() => {
      stderr = cortar(`${stderr}\nTempo esgotado`);
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout && child.stdout.on('data', (d) => {
      stdout = cortar(stdout + d.toString());
    });
    child.stderr && child.stderr.on('data', (d) => {
      stderr = cortar(stderr + d.toString());
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      const ausente = err.code === 'ENOENT';
      finish({
        code: 127,
        stdout,
        stderr: ausente ? `${cmd} nao encontrado` : err.message,
        error: err.code || 'SPAWN',
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code: code ?? 1, stdout, stderr, error: null });
    });
  });
}

function exigirBinario(resultado, cmd) {
  if (resultado && resultado.error === 'ENOENT') {
    const codigo = cmd === 'docker' ? 'DOCKER_INDISPONIVEL' : 'NPM_INDISPONIVEL';
    const mensagem = cmd === 'docker'
      ? 'Docker nao esta disponivel neste ambiente. Instale o Docker ou execute os comandos na maquina local.'
      : 'npm nao esta disponivel neste ambiente.';
    throw new HttpError(503, codigo, mensagem);
  }
  return resultado;
}

function caminhoCompose(ctx) {
  const rel = 'docker-compose.yaml';
  return ctx.resolvePath(rel);
}

function healthUrl(ctx) {
  const porta = Number(ctx.manifest && ctx.manifest.port);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw HttpError.badRequest('PORTA_AUSENTE', 'Defina port (1-65535) no studio.project.json para o healthcheck');
  }
  let caminho = '/healthcheck';
  const custom = ctx.manifest && ctx.manifest.healthPath;
  if (typeof custom === 'string' && custom.startsWith('/') && !custom.includes('..') && !/[\r\n\0]/.test(custom)) {
    caminho = custom;
  }
  return { url: `http://127.0.0.1:${porta}${caminho}`, porta, caminho, entry: (ctx.manifest && ctx.manifest.entry) || 'index.js' };
}

function checarSaude(ctx, timeoutMs = 5000) {
  const alvo = healthUrl(ctx);
  return new Promise((resolve) => {
    const req = http.get(alvo.url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => {
        body += d.toString();
        if (body.length > 4000) body = body.slice(0, 4000);
      });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body,
          ...alvo,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Tempo esgotado', ...alvo });
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message, ...alvo });
    });
  });
}

module.exports = {
  slugDo,
  servicoOpcional,
  cauda,
  argsUp,
  argsDown,
  argsLogs,
  argsNpm,
  runProcess,
  exigirBinario,
  caminhoCompose,
  healthUrl,
  checarSaude,
};
