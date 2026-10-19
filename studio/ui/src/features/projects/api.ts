// Cliente da fase projects/customization. Usa api.request do client da fundacao.

import { api, ApiError } from '../../api/client';
import { studioActions } from '../../state/store';

export { ApiError };

export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  source: 'studio' | 'user';
  questions: { id: string; label: string; type: string; required?: boolean; options?: string[] }[];
  services: string[];
  suggestedServices: string[];
  blocks: string[];
  entry: string;
}

export interface RecenteItem {
  rootPath: string;
  name: string;
  openedAt: string;
  archived?: boolean;
}

export interface LayerDraft {
  path: string;
  editor?: string;
  file?: string;
  detected?: boolean;
  unmapped?: boolean;
  hiddenByIgnore?: boolean;
  id?: string;
}

export interface ImportDetection {
  dryRun: boolean;
  wrote: boolean;
  hasManifest: boolean;
  rootPath: string;
  name: string;
  layers: (LayerDraft & { id: string })[];
  unmapped: (LayerDraft & { id: string })[];
  manifest: Record<string, unknown> | null;
}

export interface PortSuggestion {
  port: number | null;
  reserved: number[];
  services: {
    mysql: { port: number | null };
    redis: { port: number | null };
    rabbitmq: { port: number | null; managementPort: number | null };
    mailpit: { smtpPort: number | null; uiPort: number | null };
  };
}

const req = api.request;

export const projectsApi = {
  recentes: () => req<{ recentes: RecenteItem[]; archived: RecenteItem[] }>('GET', '/api/recentes'),
  templates: async () => (await req<{ templates: TemplateInfo[] }>('GET', '/api/templates')).templates,
  ports: () => req<PortSuggestion>('GET', '/api/ports'),
  workspace: () =>
    req<{
      workspace: string;
      projectsDir: string;
      userTemplates: string;
      projects: { slug: string; name: string; rootPath: string; archived: boolean; port: number | null }[];
      archived: { slug: string; name: string; rootPath: string; archived: boolean; port: number | null }[];
    }>('GET', '/api/workspace/projects'),
  open: (path: string) =>
    req<{ opened: boolean; needsImport: boolean; project?: { id: string }; detection?: ImportDetection }>('POST', '/api/projects/open', { path }),
  previewImport: (path: string) => req<ImportDetection>('POST', '/api/projects/import-preview', { path }),
  importProject: (path: string) => req<{ project: { id: string } }>('POST', '/api/projects/import', { path, confirm: true }),
  create: (body: Record<string, unknown>) => req<{ project: { id: string }; slug: string }>('POST', '/api/projects', body),
  close: (id: string) => req<{ closed: boolean }>('POST', `/api/projects/${encodeURIComponent(id)}/close`),
  clone: (id: string, name: string) => req<{ project: { id: string } }>('POST', `/api/projects/${encodeURIComponent(id)}/clone`, { name }),
  archive: (id: string) => req('POST', `/api/projects/${encodeURIComponent(id)}/archive`),
  archivePath: (path: string) => req('POST', '/api/projects/archive', { path }),
  unarchive: (path: string) => req<{ project: { id: string } }>('POST', '/api/projects/unarchive', { path }),
  saveTemplate: (id: string, body: { name: string; destination: 'user' | 'studio' }) =>
    req<{ id: string; dir: string; userTemplates: string }>('POST', `/api/projects/${encodeURIComponent(id)}/save-template`, body),
  ensureBlocks: (id: string) => req('POST', `/api/projects/${encodeURIComponent(id)}/studio-blocks`),
  manifest: (id: string) =>
    req<{
      manifest: Record<string, unknown>;
      effectiveIgnore: string[];
      defaultIgnore: string[];
    }>('GET', `/api/projects/${encodeURIComponent(id)}/manifest`),
  saveManifest: (id: string, body: Record<string, unknown>) =>
    req('PUT', `/api/projects/${encodeURIComponent(id)}/manifest`, body),
  envExample: (id: string) =>
    req<{ path: string; content: string; hash: string | null; missing?: boolean }>('GET', `/api/projects/${encodeURIComponent(id)}/env-example`),
  saveEnvExample: (id: string, content: string, baseHash: string | null) =>
    req<{ hash: string }>('PUT', `/api/projects/${encodeURIComponent(id)}/env-example`, { content, baseHash }),
  renamePreview: (id: string, layerId: string, path: string) =>
    req<RenameResult>('POST', `/api/projects/${encodeURIComponent(id)}/layers/rename`, { layerId, path, dryRun: true }),
  renameApply: (id: string, layerId: string, path: string) =>
    req<RenameResult>('POST', `/api/projects/${encodeURIComponent(id)}/layers/rename`, { layerId, path, confirm: true }),
};

export interface RenameResult {
  dryRun?: boolean;
  wrote?: boolean;
  applied?: boolean;
  from: string;
  to: string;
  directoryMove: { from: string; to: string } | null;
  changes: { path: string; diff: string; specifiers?: { from: string; to: string }[] }[];
  errors: { path: string; message: string }[];
}

export async function refreshProjects(preferId?: string) {
  const list = await api.listProjects();
  studioActions.setProjects(list);
  if (preferId && list.some((p) => p.id === preferId)) studioActions.setActiveProject(preferId);
  return list;
}

export function errorMessage(e: unknown) {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
