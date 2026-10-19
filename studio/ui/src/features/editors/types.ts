import type { ComponentType } from 'react';

/** Props recebidas por QUALQUER editor de camada (Monaco, canvas de blocos, formulario de domain...). */
export interface EditorProps {
  projectId: string;
  /** Caminho relativo ao root do projeto (ex.: "@core/domain/Usuario.js"). */
  path: string;
  /** Id da camada do arquivo (ex.: "usecase") ou null se nao mapeado. */
  layer: string | null;
}

export type LayerEditorComponent = ComponentType<EditorProps>;
