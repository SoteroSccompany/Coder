// Rotas do HUD: contexto do ponto, proposta do Jarvis e o voo do processo.
// O servidor pode ainda estar a ser ligado em paralelo; a UI trata falha sem quebrar o editor.

import { api } from '../../../api/client';
import type { FlowNode } from '../types';

const enc = encodeURIComponent;

export interface ContextoResposta {
  params: string[];
  declarados: string[];
  le: string[];
  produz: string[];
}

export interface JarvisResposta {
  placas: FlowNode[];
  posicao: number;
  fala: string;
}

export interface LigarResposta {
  ok: boolean;
  url: string;
  porta: number;
  pid: number;
}

export interface AcionarResposta {
  status: number;
  body: unknown;
  ms: number;
}

export interface PassoVoo {
  index: number;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface VooResposta {
  passos: PassoVoo[];
}

export interface TestarResposta {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  placa: { line: number; index: number } | null;
}

function lista(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => (item == null ? '' : String(item))).filter((item) => item.length > 0);
}

export function obterContexto(
  projectId: string,
  body: { blocks: FlowNode[]; params: string[]; index: number },
) {
  return api
    .request<Partial<ContextoResposta>>('POST', `/api/projects/${enc(projectId)}/blocks/contexto`, body)
    .then((raw) => ({
      params: lista(raw.params),
      declarados: lista(raw.declarados),
      le: lista(raw.le),
      produz: lista(raw.produz),
    }));
}

export function proporJarvis(projectId: string, body: { frase: string; index: number }) {
  return api
    .request<Partial<JarvisResposta>>('POST', `/api/projects/${enc(projectId)}/blocks/jarvis`, body)
    .then((raw) => ({
      placas: Array.isArray(raw.placas) ? raw.placas : [],
      posicao: Number.isInteger(raw.posicao) ? (raw.posicao as number) : 0,
      fala: typeof raw.fala === 'string' ? raw.fala : '',
    }));
}

export function ligarProcesso(projectId: string) {
  return api.request<LigarResposta>('POST', `/api/projects/${enc(projectId)}/run/ligar`);
}

export function desligarProcesso(projectId: string) {
  return api.request<{ ok?: boolean }>('POST', `/api/projects/${enc(projectId)}/run/desligar`);
}

export function acionarRota(projectId: string, body: { method: string; path: string; body: unknown }) {
  return api.request<AcionarResposta>('POST', `/api/projects/${enc(projectId)}/run/acionar`, body);
}

export function voarMetodo(
  projectId: string,
  body: { path: string; method: string; className: string | null; input: unknown },
) {
  return api.request<Partial<VooResposta>>('POST', `/api/projects/${enc(projectId)}/run/voo`, body).then((raw) => ({
    passos: Array.isArray(raw.passos) ? raw.passos : [],
  }));
}

export function testarArquivo(projectId: string, body: { path: string }) {
  return api.request<Partial<TestarResposta>>('POST', `/api/projects/${enc(projectId)}/run/testar`, body).then((raw) => ({
    ok: Boolean(raw.ok),
    code: typeof raw.code === 'number' ? raw.code : 0,
    stdout: typeof raw.stdout === 'string' ? raw.stdout : '',
    stderr: typeof raw.stderr === 'string' ? raw.stderr : '',
    placa: raw.placa && typeof raw.placa.index === 'number' ? { line: Number(raw.placa.line) || 0, index: raw.placa.index } : null,
  }));
}
