// Estado local da tela inicial e do editor de manifesto (nao entra no store global).

import { useSyncExternalStore } from 'react';

export type HomeMode = 'home' | 'new' | 'open';

interface UiState {
  home: boolean;
  mode: HomeMode;
  customize: boolean;
}

let state: UiState = { home: true, mode: 'home', customize: false };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export const projectUi = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  showHome(mode: HomeMode = 'home') {
    state = { ...state, home: true, mode };
    emit();
  },
  hideHome() {
    state = { ...state, home: false };
    emit();
  },
  setCustomize(customize: boolean) {
    state = { ...state, customize };
    emit();
  },
};

export function useProjectUi() {
  return useSyncExternalStore(projectUi.subscribe, projectUi.get);
}
