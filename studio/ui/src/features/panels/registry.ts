// ============================================================================
// REGISTRO DE PAINEIS INFERIORES  (ponto de extensao da UI)
//
// O painel inferior do App mostra uma aba por painel registrado (padrao: "Logs").
// A fase `infra` (painel de operacao) registra o seu em `src/features/<feature>/register.ts`:
//     import { registerBottomPanel } from '../panels/registry';
//     registerBottomPanel({ id: 'operacao', title: 'Operacao', order: 20, component: OperacaoPanel });
// ============================================================================

import type { ComponentType } from 'react';

export interface BottomPanel {
  id: string;
  title: string;
  /** Menor aparece primeiro. */
  order?: number;
  component: ComponentType<{ projectId: string | null }>;
}

const panels = new Map<string, BottomPanel>();
const listeners = new Set<() => void>();
let snapshot: BottomPanel[] = [];

export function registerBottomPanel(panel: BottomPanel) {
  panels.set(panel.id, panel);
  snapshot = [...panels.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  listeners.forEach((l) => l());
}

export const bottomPanels = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => snapshot,
};
