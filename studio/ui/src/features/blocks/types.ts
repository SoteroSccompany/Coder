// Tipos do editor de blocos (fluxo de um metodo e definicao .block.json).

export interface SlotDef {
  name: string;
  tipo?: string;
  direcao?: string;
  label?: string;
  padrao?: string;
  opcoes?: string[];
}

export interface ContainerDef {
  name: string;
  label?: string;
}

export interface ImportDef {
  local: string;
  source: string;
  destructure?: string[] | null;
  invoke?: boolean;
}

export interface BlockDef {
  id: string;
  label: string;
  categoria: string;
  icone?: string;
  priority?: number;
  slots?: SlotDef[];
  imports?: ImportDef[];
  template?: string;
  containers?: ContainerDef[];
  geracao?: string | null;
  origin?: string;
}

export interface FlowNode {
  id: string;
  variant?: string | null;
  geracao?: string | null;
  slots?: Record<string, string>;
  children?: Record<string, FlowNode[]>;
  source?: string;
  pristine?: boolean;
  hint?: string | null;
  templateOverride?: string | null;
  imports?: ImportDef[] | null;
}

export interface FlowMethod {
  className: string | null;
  name: string;
  async?: boolean;
  params?: string;
  blocks: FlowNode[];
}

export interface FlowResponse {
  path: string;
  hash: string;
  mtimeMs?: number;
  methods: FlowMethod[];
}

export interface ParamMarcado {
  name: string;
  start: number;
  end: number;
  tipo: 'expressao' | 'container';
}
