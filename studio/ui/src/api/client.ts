// Cliente REST + WebSocket (com reconexao automatica) do Studio Server.
// Outras fases: adicionem funcoes NOVAS em arquivos proprios (ex.: src/features/blocks/api.ts)
// usando `api.request(...)` e `studioSocket.on(...)`, sem editar este arquivo.

import type { FileContent, ProjectInfo, ProjectTree, WriteResult, WsMessage } from './types';

const TOKEN_KEY = 'studio.token';

export const getToken = (): string => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);

// ---------------------------------------------------------------- REST

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 409: o arquivo mudou no disco desde a leitura (baseHash divergente). */
export class ConflictError extends ApiError {
  currentHash: string | null;
  currentContent?: string;
  constructor(status: number, code: string, message: string, details: Record<string, unknown>) {
    super(status, code, message, details);
    this.name = 'ConflictError';
    this.currentHash = (details.currentHash as string | null) ?? null;
    this.currentContent = details.currentContent as string | undefined;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const { error, code, ...details } = data as { error?: string; code?: string };
    const message = error || res.statusText;
    if (res.status === 409) throw new ConflictError(res.status, code || 'CONFLICT', message, details);
    throw new ApiError(res.status, code || 'ERROR', message, details);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  /** Escape hatch generico para as features das proximas fases. */
  request,
  health: () => request<{ status: string; authRequired: boolean; version: string }>('GET', '/api/health'),
  listProjects: async () => (await request<{ projects: ProjectInfo[] }>('GET', '/api/projects')).projects,
  getTree: (projectId: string) => request<ProjectTree>('GET', `/api/projects/${enc(projectId)}/tree`),
  readFile: (projectId: string, path: string) =>
    request<FileContent>('GET', `/api/projects/${enc(projectId)}/file?path=${enc(path)}`),
  /** `baseHash` = hash lido; `null` para criar arquivo novo. Lanca ConflictError em 409. */
  writeFile: (projectId: string, path: string, content: string, baseHash: string | null) =>
    request<WriteResult>('PUT', `/api/projects/${enc(projectId)}/file?path=${enc(path)}`, { content, baseHash }),
};

// ------------------------------------------------------------ WebSocket

export type ConnectionState = 'connecting' | 'open' | 'closed';
type Handler = (msg: WsMessage) => void;

class StudioSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private stateHandlers = new Set<(s: ConnectionState) => void>();
  private subscriptions = new Set<string>();
  private retry = 0;
  private timer: number | undefined;
  private stopped = false;
  state: ConnectionState = 'closed';

  connect() {
    this.stopped = false;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.setState('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const token = getToken();
    const ws = new WebSocket(`${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.setState('open');
      this.subscriptions.forEach((id) => this.send({ type: 'subscribe', projectId: id }));
    };
    ws.onmessage = (ev) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handlers.get(msg.type)?.forEach((h) => h(msg));
      this.handlers.get('*')?.forEach((h) => h(msg));
    };
    ws.onclose = () => {
      this.setState('closed');
      if (this.stopped) return;
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  disconnect() {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.ws?.close();
  }

  /** Assina o canal de um projeto (reassinado automaticamente apos reconexao). */
  subscribe(projectId: string) {
    this.subscriptions.add(projectId);
    this.send({ type: 'subscribe', projectId });
  }

  unsubscribe(projectId: string) {
    this.subscriptions.delete(projectId);
    this.send({ type: 'unsubscribe', projectId });
  }

  /** Escuta um tipo de evento (ex.: 'file:changed') ou '*' para todos. Retorna a funcao de cancelamento. */
  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onState(handler: (s: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setState(s: ConnectionState) {
    this.state = s;
    this.stateHandlers.forEach((h) => h(s));
  }
}

export const studioSocket = new StudioSocket();
