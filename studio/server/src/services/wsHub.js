'use strict';

/**
 * Hub WebSocket com canais por projeto.
 *
 * Protocolo (JSON):
 *   servidor -> cliente: { type, projectId, payload, ts }
 *   cliente  -> servidor: { type: 'subscribe'|'unsubscribe', projectId }  |  { type: 'ping' }
 * Mensagem de boas-vindas: { type: 'hello', projectId: null, payload: { subscriptions: [] } }
 *
 * Endpoint: `/ws` (query opcional `?project=<id>` assina ja na conexao e `?token=` quando STUDIO_TOKEN existir).
 *
 * API para as outras fases:  hub.publish(projectId, type, payload)  /  hub.broadcast(type, payload)
 * Convencao de `type`: "<dominio>:<evento>" (ex.: file:changed, log:line, blocks:updated).
 */

const { WebSocketServer } = require('ws');
const { EventEmitter } = require('events');

const OPEN = 1;

function createWsHub({ authenticate } = {}) {
  const emitter = new EventEmitter();
  const channels = new Map(); // projectId -> Set<ws>
  let wss = null;
  let heartbeat = null;

  function subscribe(ws, projectId) {
    if (!projectId) return;
    if (!channels.has(projectId)) channels.set(projectId, new Set());
    channels.get(projectId).add(ws);
    ws.subscriptions.add(projectId);
  }

  function unsubscribe(ws, projectId) {
    const set = channels.get(projectId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) channels.delete(projectId);
    }
    ws.subscriptions.delete(projectId);
  }

  function send(ws, msg) {
    if (ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  }

  /** Publica um evento para quem assinou o canal do projeto. Retorna o numero de destinatarios. */
  function publish(projectId, type, payload = {}) {
    const msg = { type, projectId, payload, ts: Date.now() };
    emitter.emit('publish', msg); // permite que servicos internos (e testes) escutem
    const set = channels.get(projectId);
    if (!set) return 0;
    let n = 0;
    for (const ws of set) {
      send(ws, msg);
      n++;
    }
    return n;
  }

  /** Envia para todos os clientes conectados (independe de assinatura). */
  function broadcast(type, payload = {}) {
    if (!wss) return 0;
    const msg = { type, projectId: null, payload, ts: Date.now() };
    let n = 0;
    for (const ws of wss.clients) {
      send(ws, msg);
      n++;
    }
    return n;
  }

  /** Acopla ao servidor HTTP (upgrade em /ws). */
  function attach(server) {
    wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      if (authenticate && !authenticate(req, url)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.subscriptions = new Set();
        ws.isAlive = true;
        ws.on('pong', () => (ws.isAlive = true));
        ws.on('message', (data) => {
          let msg;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            return;
          }
          if (msg.type === 'subscribe') subscribe(ws, msg.projectId);
          else if (msg.type === 'unsubscribe') unsubscribe(ws, msg.projectId);
          else if (msg.type === 'ping') send(ws, { type: 'pong', projectId: null, payload: {}, ts: Date.now() });
          emitter.emit('client-message', ws, msg);
        });
        ws.on('close', () => {
          for (const pid of [...ws.subscriptions]) unsubscribe(ws, pid);
        });
        ws.on('error', () => {});

        const initial = url.searchParams.get('project');
        if (initial) subscribe(ws, initial);
        send(ws, { type: 'hello', projectId: null, payload: { subscriptions: [...ws.subscriptions] }, ts: Date.now() });
      });
    });

    heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, 30000);
    heartbeat.unref();
  }

  function close() {
    if (heartbeat) clearInterval(heartbeat);
    if (wss) {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    }
    channels.clear();
  }

  return {
    attach,
    publish,
    broadcast,
    close,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    subscribersOf: (projectId) => (channels.get(projectId) ? channels.get(projectId).size : 0),
  };
}

module.exports = { createWsHub };
