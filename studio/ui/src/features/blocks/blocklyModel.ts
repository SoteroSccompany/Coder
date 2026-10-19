// Monta as definicoes do Blockly a partir do .block.json e le o workspace de volta.

import * as Blockly from 'blockly';
import type { BlockDef, FlowNode } from './types';

const CORES: Record<string, number> = {
  fluxo: 210,
  dados: 160,
  seguranca: 20,
  infra: 290,
  livre: 65,
};

const ROTULOS: Record<string, string> = {
  fluxo: 'Fluxo',
  dados: 'Dados',
  seguranca: 'Seguranca',
  infra: 'Infra',
  livre: 'Livre',
};

const definidos = new Set<string>();

export function rotuloCategoria(id: string) {
  return ROTULOS[id] || id;
}

function definicao(block: BlockDef): Record<string, unknown> {
  const json: Record<string, unknown> = {
    type: block.id,
    colour: CORES[block.categoria] ?? 200,
    previousStatement: null,
    nextStatement: null,
  };
  let i = 0;
  json[`message${i}`] = block.label;
  i += 1;
  for (const slot of block.slots || []) {
    json[`message${i}`] = `${slot.label || slot.name} %1`;
    json[`args${i}`] = [{ type: 'field_input', name: slot.name, text: slot.padrao || '' }];
    i += 1;
  }
  for (const c of block.containers || []) {
    json[`message${i}`] = `${c.label || c.name} %1`;
    json[`args${i}`] = [{ type: 'input_statement', name: c.name }];
    i += 1;
  }
  return json;
}

export function registrarBlocos(defs: BlockDef[]) {
  const novos = defs.filter((d) => d.id && !definidos.has(d.id));
  if (!novos.length) return;
  Blockly.defineBlocksWithJsonArray(novos.map(definicao));
  novos.forEach((d) => definidos.add(d.id));
}

export function caixaDeFerramentas(defs: BlockDef[]): Blockly.utils.toolbox.ToolboxInfo {
  const porCategoria = new Map<string, BlockDef[]>();
  for (const d of defs) {
    const cat = d.categoria || 'livre';
    const lista = porCategoria.get(cat) || [];
    lista.push(d);
    porCategoria.set(cat, lista);
  }
  const ordem = ['fluxo', 'dados', 'seguranca', 'infra', 'livre'];
  const nomes = [...porCategoria.keys()].sort((a, b) => {
    const ia = ordem.indexOf(a);
    const ib = ordem.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return {
    kind: 'categoryToolbox',
    contents: nomes.map((nome) => ({
      kind: 'category',
      name: rotuloCategoria(nome),
      colour: String(CORES[nome] ?? 200),
      contents: (porCategoria.get(nome) || []).map((d) => ({ kind: 'block', type: d.id })),
    })),
  };
}

function metaDe(block: Blockly.Block): FlowNode | null {
  if (!block.data) return null;
  try {
    const parsed = JSON.parse(block.data) as FlowNode;
    return parsed && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

function slotsDoBloco(block: Blockly.Block, def?: BlockDef) {
  const slots: Record<string, string> = {};
  for (const s of def?.slots || []) {
    const v = block.getFieldValue(s.name);
    slots[s.name] = v == null ? '' : String(v);
  }
  return slots;
}

function slotsIguais(lidos: Record<string, string>, originais: Record<string, string> | undefined) {
  const chaves = new Set([...Object.keys(lidos), ...Object.keys(originais || {})]);
  for (const k of chaves) {
    if (String(lidos[k] ?? '') !== String((originais || {})[k] ?? '')) return false;
  }
  return true;
}

/** Le a arvore. Bloco intocado devolve o no original (com `source`) para o servidor nao reescrever. */
export function lerBloco(block: Blockly.Block, defs: Map<string, BlockDef>): FlowNode {
  const def = defs.get(block.type);
  const meta = metaDe(block);
  const slots = slotsDoBloco(block, def);
  const children: Record<string, FlowNode[]> = {};
  const origChildren = meta?.children || {};
  let filhosIguais = true;
  const nomes = new Set([...(def?.containers || []).map((c) => c.name), ...Object.keys(origChildren)]);
  for (const nome of nomes) {
    const input = block.getInput(nome);
    const kids: FlowNode[] = [];
    let child = input?.connection?.targetBlock() ?? null;
    while (child) {
      kids.push(lerBloco(child, defs));
      child = child.getNextBlock();
    }
    children[nome] = kids;
    const orig = origChildren[nome] || [];
    if (kids.length !== orig.length || kids.some((k, i) => k !== orig[i])) filhosIguais = false;
  }
  if (meta && slotsIguais(slots, meta.slots) && filhosIguais) return meta;
  return {
    id: block.type,
    variant: meta?.variant ?? null,
    geracao: meta?.geracao ?? def?.geracao ?? null,
    slots,
    children,
    pristine: false,
  };
}

export function lerPilha(workspace: Blockly.WorkspaceSvg, defs: Map<string, BlockDef>): FlowNode[] {
  const out: FlowNode[] = [];
  for (const topo of workspace.getTopBlocks(true)) {
    let atual: Blockly.Block | null = topo;
    while (atual) {
      out.push(lerBloco(atual, defs));
      atual = atual.getNextBlock();
    }
  }
  return out;
}

export function montarPilha(workspace: Blockly.WorkspaceSvg, nodes: FlowNode[]) {
  let anterior: Blockly.BlockSvg | null = null;
  for (const node of nodes) {
    const bloco = criarBloco(workspace, node);
    if (anterior?.nextConnection && bloco.previousConnection) {
      anterior.nextConnection.connect(bloco.previousConnection);
    }
    anterior = bloco;
  }
}

function criarBloco(workspace: Blockly.WorkspaceSvg, node: FlowNode): Blockly.BlockSvg {
  const bloco = workspace.newBlock(node.id);
  bloco.data = JSON.stringify(node);
  for (const [nome, valor] of Object.entries(node.slots || {})) {
    try {
      bloco.setFieldValue(String(valor ?? ''), nome);
    } catch {
      /* o bloco da paleta pode nao ter esse campo */
    }
  }
  bloco.initSvg();
  bloco.render();
  for (const [nome, filhos] of Object.entries(node.children || {})) {
    const entrada = bloco.getInput(nome);
    if (!entrada?.connection || !filhos?.length) continue;
    let anterior: Blockly.BlockSvg | null = null;
    for (const filho of filhos) {
      const criado = criarBloco(workspace, filho);
      if (!anterior) entrada.connection.connect(criado.previousConnection!);
      else if (anterior.nextConnection && criado.previousConnection) anterior.nextConnection.connect(criado.previousConnection);
      anterior = criado;
    }
  }
  return bloco;
}
