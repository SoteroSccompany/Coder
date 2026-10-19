// Cliente REST da fase de blocos. Usa `api.request` sem alterar o client compartilhado.

import { api } from '../../api/client';
import type { BlockDef, FlowMethod, FlowResponse, ParamMarcado } from './types';

const enc = encodeURIComponent;

export function listarBiblioteca(projectId: string) {
  return api.request<{ blocks: BlockDef[] }>('GET', `/api/projects/${enc(projectId)}/blocks`);
}

export function obterFluxo(projectId: string, path: string) {
  return api.request<FlowResponse>('GET', `/api/projects/${enc(projectId)}/blocks/flow?path=${enc(path)}`);
}

export function salvarFluxo(
  projectId: string,
  path: string,
  body: { method: string; className?: string | null; blocks: FlowMethod['blocks']; baseHash: string },
) {
  return api.request<{ path: string; hash: string; content: string; unchanged?: boolean }>(
    'PUT',
    `/api/projects/${enc(projectId)}/blocks/flow?path=${enc(path)}`,
    body,
  );
}

export function criarBloco(
  projectId: string,
  body: {
    code: string;
    id: string;
    label: string;
    categoria: string;
    icone?: string;
    params: ParamMarcado[];
    scope: 'project' | 'global';
    imports?: { local: string; source: string }[];
  },
) {
  return api.request<{ path: string; scope: string; block: BlockDef }>('POST', `/api/projects/${enc(projectId)}/blocks`, body);
}
