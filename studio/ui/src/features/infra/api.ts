import { api } from '../../api/client';

const enc = encodeURIComponent;

export interface ItemCatalogo {
  id: string;
  titulo: string;
  descricao: string;
  porta: number;
  env: string[];
  blocos: string[];
  gateway: string;
}

export interface SaidaComando {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  comando: string[];
}

export const infraApi = {
  catalogo: (projectId: string) =>
    api.request<{ catalogo: ItemCatalogo[] }>('GET', `/api/projects/${enc(projectId)}/infra/catalogo`),
  servicos: (projectId: string) =>
    api.request<{ servicos: string[] }>('GET', `/api/projects/${enc(projectId)}/infra/servicos`),
  adicionar: (projectId: string, id: string) =>
    api.request<{ id: string; jaExistia: boolean; gatewayCriado: boolean; blocos: string[] }>(
      'POST',
      `/api/projects/${enc(projectId)}/infra/servicos`,
      { id },
    ),
  up: (projectId: string) => api.request<SaidaComando>('POST', `/api/projects/${enc(projectId)}/infra/up`, {}),
  down: (projectId: string) => api.request<SaidaComando>('POST', `/api/projects/${enc(projectId)}/infra/down`, {}),
  logs: (projectId: string) => api.request<SaidaComando>('GET', `/api/projects/${enc(projectId)}/infra/logs?tail=200`),
  migrate: (projectId: string) => api.request<SaidaComando>('POST', `/api/projects/${enc(projectId)}/infra/migrate`, {}),
  testar: (projectId: string) => api.request<SaidaComando>('POST', `/api/projects/${enc(projectId)}/infra/test`, {}),
  health: (projectId: string) =>
    api.request<{ ok: boolean; url?: string; status?: number; error?: string; entry?: string }>(
      'GET',
      `/api/projects/${enc(projectId)}/infra/health`,
    ),
};
