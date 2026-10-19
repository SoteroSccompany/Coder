// Tipos dos contratos REST/WS do Studio Server (ver studio/README.md).

export interface LayerInfo {
  id: string;
  path: string;
  basePath: string;
  editor: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  hasManifest: boolean;
  layers: LayerInfo[];
  ignore: string[];
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

export interface TreeLayer extends LayerInfo {
  exists: boolean;
  children: TreeNode[];
}

export interface ProjectTree {
  projectId: string;
  name: string;
  layers: TreeLayer[];
  other: TreeNode[];
}

export interface FileContent {
  path: string;
  content: string;
  hash: string;
  mtimeMs: number;
  size: number;
  layer: string | null;
}

export interface WriteResult {
  path: string;
  hash: string;
  mtimeMs: number;
  size: number;
  created: boolean;
}

/** Envelope das mensagens WebSocket servidor -> cliente. */
export interface WsMessage<P = Record<string, unknown>> {
  type: string;
  projectId: string | null;
  payload: P;
  ts: number;
}

export interface FileEventPayload {
  path: string;
  layer: string | null;
  hash?: string;
  mtimeMs?: number;
}
