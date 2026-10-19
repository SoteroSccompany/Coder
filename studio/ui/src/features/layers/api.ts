import { api } from '../../api/client';

const enc = encodeURIComponent;

export type CampoKind = 'plain' | 'uuid' | 'dateNow' | 'boolean' | 'custom';

export interface Campo {
  name: string;
  kind: CampoKind;
  expression?: string;
}

export interface DomainView {
  path: string;
  hash: string;
  className: string | null;
  getter: string | null;
  fields: Campo[];
}

export interface RepoView {
  path: string;
  hash: string;
  className: string | null;
  tableName: string | null;
  methods: { name: string; kind: string; async: boolean }[];
}

export interface RotaLinha {
  file: string;
  router: string;
  method: string;
  path: string;
  handler: string | null;
}

export interface RotasView {
  rotas: RotaLinha[];
  controllers: { file: string; className: string | null; metodos: string[] }[];
  arquivos: Record<string, { hash: string }>;
  erros: { file: string; error: string }[];
}

export const layersApi = {
  lerDomain: (projectId: string, filePath: string) =>
    api.request<DomainView>('GET', `/api/projects/${enc(projectId)}/layers/domain?path=${enc(filePath)}`),
  salvarDomain: (projectId: string, filePath: string, fields: Campo[], baseHash: string) =>
    api.request<DomainView>('PUT', `/api/projects/${enc(projectId)}/layers/domain?path=${enc(filePath)}`, { fields, baseHash }),
  lerRepo: (projectId: string, filePath: string) =>
    api.request<RepoView>('GET', `/api/projects/${enc(projectId)}/layers/repository?path=${enc(filePath)}`),
  inserirMetodo: (projectId: string, filePath: string, body: { kind: string; name: string; table?: string; baseHash: string }) =>
    api.request<{ path: string; hash: string; name: string; kind: string; tableName: string }>(
      'POST',
      `/api/projects/${enc(projectId)}/layers/repository/metodo?path=${enc(filePath)}`,
      body,
    ),
  lerRotas: (projectId: string) => api.request<RotasView>('GET', `/api/projects/${enc(projectId)}/layers/rotas`),
  salvarRota: (projectId: string, body: Record<string, unknown>) =>
    api.request<{ path: string; criada?: boolean; removida?: boolean; handlerCriado?: boolean; aviso?: string }>(
      'POST',
      `/api/projects/${enc(projectId)}/layers/rotas`,
      body,
    ),
  listarWorkers: (projectId: string) =>
    api.request<{ workers: string[] }>('GET', `/api/projects/${enc(projectId)}/layers/workers`),
  criarWorker: (projectId: string, nome: string, fila: string) =>
    api.request<{ path: string }>('POST', `/api/projects/${enc(projectId)}/layers/workers`, { nome, fila, baseHash: null }),
  criarMigration: (projectId: string, body: { table: string; columns: { name: string; type: string; length?: number; pk?: boolean; nullable?: boolean }[] }) =>
    api.request<{ path: string }>('POST', `/api/projects/${enc(projectId)}/layers/migrations`, body),
  criarEntidade: (projectId: string, body: { entity: string; table: string; fields: string[] }) =>
    api.request<{ entity: string; arquivos: { path: string }[] }>('POST', `/api/projects/${enc(projectId)}/layers/entidade`, body),
};
