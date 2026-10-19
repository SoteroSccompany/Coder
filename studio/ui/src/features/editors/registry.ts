// ============================================================================
// REGISTRO DE EDITORES POR CAMADA  (ponto de extensao da UI)
//
// Mapa  layerId -> componente de editor.  Camada sem entrada usa o editor padrao (Monaco).
//
// Como uma fase seguinte registra o seu editor SEM editar arquivos existentes:
//   1. crie `src/features/<sua-feature>/register.ts` (carregado automaticamente por
//      `src/features/registrations.ts`);
//   2. dentro dele:
//        import { registerLayerEditor } from '../editors/registry';
//        import { BlocksEditor } from './BlocksEditor';
//        registerLayerEditor('usecase', BlocksEditor);
//
// (Alternativa: acrescentar a entrada em `layerEditors` abaixo — unico arquivo existente
//  que as fases podem editar para este fim.)
//
// O componente recebe `EditorProps` (projectId, path, layer). Para ler/gravar o arquivo com
// controle de conflito (hash) e aviso de mudanca externa, use `useFileDocument`
// (src/features/editor/useFileDocument.ts). O Monaco continua disponivel: o usuario pode
// alternar para "Texto" no cabecalho do editor.
// ============================================================================

import { lazy } from 'react';
import type { LayerEditorComponent } from './types';

/** Editor padrao: Monaco (carregado sob demanda para nao pesar o bundle inicial). */
export const DefaultEditor: LayerEditorComponent = lazy(() =>
  import('../editor/MonacoFileEditor').then((m) => ({ default: m.MonacoFileEditor })),
);

/** layerId -> editor. Preenchido por `registerLayerEditor` (ou diretamente aqui). */
export const layerEditors: Record<string, LayerEditorComponent> = {
  // usecase: BlocksEditor,       // fase `blocks-engine`
  // domain: DomainFormEditor,    // fase `layers`
  // migration: MigrationDesigner // fase `layers`
};

export function registerLayerEditor(layerId: string, component: LayerEditorComponent) {
  layerEditors[layerId] = component;
}

/** Editor customizado da camada (ou undefined se a camada usa so o Monaco). */
export function getCustomEditor(layerId: string | null): LayerEditorComponent | undefined {
  return layerId ? layerEditors[layerId] : undefined;
}
