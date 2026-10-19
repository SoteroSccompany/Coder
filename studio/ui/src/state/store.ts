// Store global minimo (sem dependencias) baseado em useSyncExternalStore.
// Cada feature pode manter seu proprio estado local; aqui fica so o que e compartilhado:
// projetos abertos, projeto ativo, arquivos abertos por projeto, conexao e logs.

import { useSyncExternalStore } from 'react';
import type { ProjectInfo } from '../api/types';
import type { ConnectionState } from '../api/client';

export interface ProjectUiState {
  openFiles: string[];
  activeFile: string | null;
}

export interface LogEntry {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  projectId?: string | null;
  source?: string;
}

export interface StudioState {
  projects: ProjectInfo[];
  activeProjectId: string | null;
  byProject: Record<string, ProjectUiState>;
  logs: LogEntry[];
  connection: ConnectionState;
}

let state: StudioState = {
  projects: [],
  activeProjectId: null,
  byProject: {},
  logs: [],
  connection: 'closed',
};
let logSeq = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<StudioState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const emptyProjectState: ProjectUiState = { openFiles: [], activeFile: null };

export const studioStore = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const studioActions = {
  setProjects(projects: ProjectInfo[]) {
    const activeProjectId =
      state.activeProjectId && projects.some((p) => p.id === state.activeProjectId)
        ? state.activeProjectId
        : projects[0]?.id ?? null;
    set({ projects, activeProjectId });
  },
  setActiveProject(id: string) {
    set({ activeProjectId: id });
  },
  setConnection(connection: ConnectionState) {
    set({ connection });
  },
  openFile(projectId: string, path: string) {
    const cur = state.byProject[projectId] ?? emptyProjectState;
    const openFiles = cur.openFiles.includes(path) ? cur.openFiles : [...cur.openFiles, path];
    set({ byProject: { ...state.byProject, [projectId]: { openFiles, activeFile: path } } });
  },
  activateFile(projectId: string, path: string) {
    const cur = state.byProject[projectId] ?? emptyProjectState;
    set({ byProject: { ...state.byProject, [projectId]: { ...cur, activeFile: path } } });
  },
  closeFile(projectId: string, path: string) {
    const cur = state.byProject[projectId] ?? emptyProjectState;
    const openFiles = cur.openFiles.filter((p) => p !== path);
    const activeFile = cur.activeFile === path ? openFiles[openFiles.length - 1] ?? null : cur.activeFile;
    set({ byProject: { ...state.byProject, [projectId]: { openFiles, activeFile } } });
  },
  log(level: LogEntry['level'], message: string, extra: Partial<Pick<LogEntry, 'projectId' | 'source'>> = {}) {
    const entry: LogEntry = { id: ++logSeq, ts: Date.now(), level, message, ...extra };
    set({ logs: [...state.logs.slice(-499), entry] });
  },
  clearLogs() {
    set({ logs: [] });
  },
};

/** Hook com seletor. O seletor deve devolver referencias estaveis (nao crie objetos novos a cada chamada). */
export function useStudio<T>(selector: (s: StudioState) => T): T {
  return useSyncExternalStore(studioStore.subscribe, () => selector(state));
}

export const selectProjectUi = (s: StudioState): ProjectUiState =>
  (s.activeProjectId && s.byProject[s.activeProjectId]) || emptyProjectState;
