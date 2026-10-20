'use strict';

/**
 * Jarvis local: uma frase em portugues vira uma proposta de placas.
 * Nao grava arquivo. A UI confirma antes de encaixar no fluxo.
 */

const PARADA = new Set([
  'devolve', 'devolver', 'devolvendo', 'retorna', 'retornar', 'retorno',
  'ok', 'true', 'false', 'erro', 'falha', 'status', 'msg', 'mensagem',
  'guarda', 'guardar', 'guard', 'se', 'senao', 'nao', 'sim',
  'busca', 'buscar', 'usuario', 'user',
  'transacao', 'auditoria', 'sha', 'bcrypt', 'otp', 'qrcode', 'qr', 'code',
  'fila', 'rabbit', 'rabbitmq', 'redis', 'cache', 'email', 'mail',
  'bucket', 'upload', 'comentario', 'com', 'sem', 'para', 'por', 'uma', 'um',
  'o', 'a', 'os', 'as', 'do', 'da', 'de', 'em', 'no', 'na', 'e', 'ou',
  'novo', 'nova', 'abre', 'abrir', 'grava', 'gravar', 'envia', 'enviar',
  'consome', 'consumir', 'publica', 'publicar', 'gera', 'gerar', 'codigo',
]);

const REGRAS = [
  { id: 'fluxo.guard-status', re: /\b(?:guards?|guarda(?:r)?|sem status|se nao tiver status)\b/ },
  { id: 'fluxo.retornar-status', re: /\b(?:devolve|devolv\w*|retorna|retorn\w*)\b/ },
  { id: 'dados.buscar-usuario', re: /\bbusc(?:a|ar)\s+(?:o\s+|um\s+)?(?:usuario|user)\b/ },
  { id: 'dados.transacao-knex', re: /\btransac\w*\b/ },
  { id: 'dados.gravar-auditoria', re: /\bauditori\w*\b/ },
  { id: 'seguranca.sha', re: /\bsha\b/ },
  { id: 'seguranca.bcrypt', re: /\bbcrypt\b/ },
  { id: 'seguranca.otp-qrcode', re: /\botp\b|\bqr\s*code\b|\bqrcode\b/ },
  { id: 'fila', re: /\bfilas?\b|\brabbit(?:mq)?\b/ },
  { id: 'infra.cache-redis', re: /\bredis\b/ },
  { id: 'infra.enviar-email', re: /\be-?mails?\b/ },
  { id: 'infra.upload-bucket', re: /\bbucket\b|\bupload\b/ },
  { id: 'fluxo.se-senao', re: /\bsenao\b/ },
  { id: 'livre.comentario', re: /\bcomentarios?\b/ },
];

function normalizar(frase) {
  return String(frase || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function mapa(library) {
  if (!library) return new Map();
  if (library instanceof Map) return library;
  return new Map(library.map((b) => [b.id, b]));
}

function posicaoDe(index) {
  if (index == null || index === '') return -1;
  const n = Number(index);
  if (!Number.isInteger(n)) return -1;
  return n;
}

/** Primeira mensagem entre aspas, como literal JS. */
function aspas(frase) {
  const m = String(frase || '').match(/"([^"\\]*)"|'([^'\\]*)'|“([^”]*)”/);
  if (!m) return null;
  return JSON.stringify(m[1] ?? m[2] ?? m[3]);
}

function nomeUtil(frase) {
  const candidatos = normalizar(frase).match(/\b[a-zA-Z_$][\w$]*\b/g) || [];
  for (const c of candidatos) {
    if (!PARADA.has(c.toLowerCase())) return c;
  }
  return null;
}

function variavelDe(frase, padrao) {
  const norm = normalizar(frase);
  const marcado = norm.match(/\b(?:em|como|variavel)\s+([a-zA-Z_$][\w$]*)/);
  if (marcado && !PARADA.has(marcado[1].toLowerCase())) return marcado[1];
  return nomeUtil(frase) || padrao;
}

function mensagemDe(frase, padrao) {
  return aspas(frase) || JSON.stringify(padrao);
}

function statusDe(frase) {
  const norm = normalizar(frase);
  if (/\b(false|erro|falha|negad\w*|invalido|falhou)\b/.test(norm)) return 'false';
  const num = norm.match(/\bstatus\s+(\d{3})\b/);
  if (num) return num[1];
  return 'true';
}

function placa(id, slots, extra) {
  return {
    id,
    variant: (extra && extra.variant) || null,
    geracao: (extra && extra.geracao) || null,
    slots,
    children: (extra && extra.children) || {},
  };
}

function montarUma(id, frase) {
  const norm = normalizar(frase);
  switch (id) {
    case 'fluxo.guard-status':
      return placa(id, {
        alvo: variavelDe(frase, 'data'),
        msg: mensagemDe(frase, 'negado'),
      });
    case 'fluxo.retornar-status': {
      const citada = aspas(frase);
      let msg = citada;
      if (!msg) {
        const m = norm.match(/\b(?:devolve|devolv\w*|retorna|retorn\w*)\s+(?:status\s+)?([a-z0-9_]+)/);
        if (m && !['com', 'a', 'o', 'os', 'as', 'um', 'uma', 'para', 'mensagem', 'status'].includes(m[1])) {
          msg = JSON.stringify(m[1]);
        }
      }
      return placa(id, { status: statusDe(frase), msg: msg || '"ok"' });
    }
    case 'dados.buscar-usuario':
      return placa(id, {
        variavel: variavelDe(frase, 'user'),
        argumentos: aspas(frase) || 'data.id',
      }, { geracao: 'chamada' });
    case 'dados.transacao-knex':
      return placa(id, { trx: variavelDe(frase, 'trx'), erro: 'error' });
    case 'dados.gravar-auditoria':
      return placa(id, {
        variavel: variavelDe(frase, 'auditoria'),
        ledger: 'Ledger',
        argumento: 'data',
        inicial: '',
        metodo: 'GravarAuditoria',
        payload: aspas(frase) || 'data',
      });
    case 'seguranca.sha':
      return placa(id, {
        variavel: variavelDe(frase, 'hash'),
        argumentos: aspas(frase) || 'data',
        alvo: 'sha',
        metodo: /\bdecrypt\b/.test(norm) ? 'decrypt' : /\bhash\b/.test(norm) ? 'hash' : 'encrypt',
      });
    case 'seguranca.bcrypt':
      return placa(id, {
        variavel: variavelDe(frase, 'senha'),
        argumentos: aspas(frase) || 'data.senha',
        alvo: 'bcrypt',
        metodo: /\bcompare\b/.test(norm) ? 'compare' : 'encrypt',
      });
    case 'seguranca.otp-qrcode':
      return placa(id, {
        variavel: variavelDe(frase, 'secret'),
        alvo: 'authenticator',
        metodo: 'generateSecret',
        argumentos: '',
      }, { geracao: 'chamada' });
    case 'fila':
      if (/\bconsum/.test(norm)) {
        return placa('infra.consumir-fila', {
          variavel: variavelDe(frase, 'fila'),
          alvo: 'rabbitMQ',
          metodo: 'consumeMessage',
          argumentos: aspas(frase) || "'fila'",
        }, { geracao: 'chamada' });
      }
      return placa('infra.publicar-fila', {
        variavel: variavelDe(frase, 'dispatcher'),
        argumentos: 'rabbit, []',
        item: aspas(frase) || 'data',
      });
    case 'infra.cache-redis':
      return placa(id, {
        variavel: variavelDe(frase, 'valor'),
        alvo: 'redis',
        metodo: /\bdel\b/.test(norm) ? 'del' : /\bget\b/.test(norm) ? 'get' : 'set',
        argumentos: aspas(frase) || 'chave',
      }, { geracao: 'chamada' });
    case 'infra.enviar-email':
      return placa(id, {
        variavel: variavelDe(frase, 'envio'),
        alvo: 'email',
        metodo: 'sendEmail',
        argumentos: aspas(frase) || 'data',
      }, { geracao: 'chamada' });
    case 'infra.upload-bucket':
      return placa(id, {
        variavel: variavelDe(frase, 'url'),
        alvo: 'bucket',
        metodo: 'urlUploadPut',
        argumentos: aspas(frase) || 'arquivo',
      }, { geracao: 'chamada' });
    case 'fluxo.se-senao': {
      const cond = norm.match(/\bse\s+(.+?)\s+senao\b/);
      return placa(id, { condicao: cond ? cond[1].trim() : 'true' }, {
        variant: 'se-senao',
        children: { entao: [], senao: [] },
      });
    }
    case 'livre.comentario': {
      const citada = aspas(frase);
      const texto = citada
        ? JSON.parse(citada)
        : String(frase || '').replace(/coment[aá]rios?:?/i, '').trim();
      return placa(id, { texto: texto || String(frase || '').trim() });
    }
    default:
      return placa('livre.codigo-livre', { codigo: String(frase || '').trim() });
  }
}

function falaDe(def, slots) {
  if (!def || !def.fala) return '';
  return String(def.fala)
    .replace(/\{\{(\w+)\??\}\}/g, (_, nome) => (slots[nome] == null ? '' : String(slots[nome])))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} frase
 * @param {number} index  placa anterior; -1 insere no inicio
 * @param {Array<object>|Map<string, object>} [library]
 * @returns {{ placas: object[], posicao: number, fala: string }}
 */
function propor(frase, index, library) {
  const texto = String(frase || '');
  const norm = normalizar(texto);
  const lib = mapa(library);
  const achados = [];
  if (norm) {
    for (const regra of REGRAS) {
      const m = regra.re.exec(norm);
      if (m) achados.push({ id: regra.id, em: m.index });
    }
    achados.sort((a, b) => a.em - b.em);
  }
  const bases = achados.length
    ? achados.map((a) => montarUma(a.id, texto))
    : [placa('livre.codigo-livre', { codigo: texto.trim() })];

  const placas = bases.map((p) => {
    const def = lib.get(p.id);
    return {
      id: p.id,
      variant: p.variant,
      geracao: p.geracao || (def && def.geracao) || null,
      slots: p.slots,
      children: p.children,
    };
  });
  const falas = placas.map((p) => falaDe(lib.get(p.id), p.slots)).filter(Boolean);
  return {
    placas,
    posicao: posicaoDe(index),
    fala: falas.join(' ') || texto.trim(),
  };
}

module.exports = { propor, posicaoDe };
