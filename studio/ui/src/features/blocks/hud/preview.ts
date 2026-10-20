// Previa local do metodo e da fala. Espelha o preenchimento de template de generate.js
// o suficiente para o painel da direita ser honesto quando nao ha endpoint de preview.
// No intacto (pristine + source) mostra o trecho original.

import type { BlockDef, FlowMethod, FlowNode, SlotDef } from '../types';

const CALL_TEMPLATES: Record<string, string> = {
  'const-await': 'const {{variavel}} = await {{alvo}}.{{metodo}}({{argumentos}});',
  const: 'const {{variavel}} = {{alvo}}.{{metodo}}({{argumentos}});',
  await: 'await {{alvo}}.{{metodo}}({{argumentos}});',
  expr: '{{alvo}}.{{metodo}}({{argumentos}});',
  'assign-await': '{{variavel}} = await {{alvo}}.{{metodo}}({{argumentos}});',
  assign: '{{variavel}} = {{alvo}}.{{metodo}}({{argumentos}});',
  'return-await': 'return await {{alvo}}.{{metodo}}({{argumentos}});',
  return: 'return {{alvo}}.{{metodo}}({{argumentos}});',
};

const NEW_TEMPLATE = 'const {{variavel}} = new {{classe}}({{argumentos}});';

export function parametrosDoMetodo(params?: string): string[] {
  if (!params) return [];
  return params
    .split(',')
    .map((parte) => parte.trim().replace(/^\.{3}/, '').split('=')[0].trim())
    .filter((nome) => /^[A-Za-z_$][\w$]*$/.test(nome));
}

export function aplicarSlots(texto: string, slots: Record<string, string> | undefined, defs?: SlotDef[]): string {
  return texto.replace(/\{\{(\w+)\??\}\}/g, (_, name: string) => {
    const valor = slots?.[name];
    if (valor != null && valor !== '') return String(valor);
    const label = defs?.find((s) => s.name === name)?.label;
    return label ? `[${label}]` : '';
  });
}

function templateDe(def: BlockDef | undefined, node: FlowNode): string {
  if (!def) return (node.slots && node.slots.codigo) || '';
  if (node.templateOverride) return node.templateOverride;
  if (node.variant && def.templates && def.templates[node.variant]) return def.templates[node.variant];
  if ((node.geracao === 'chamada' || def.geracao === 'chamada') && node.variant && CALL_TEMPLATES[node.variant]) {
    return CALL_TEMPLATES[node.variant];
  }
  if (node.geracao === 'new') {
    if (def.template && (def.template.includes('{{classe}}') || /new\s+\S/.test(def.template))) return def.template;
    return NEW_TEMPLATE;
  }
  return def.template || '';
}

export function falaDaPlaca(def: BlockDef | undefined, node: FlowNode): string {
  if (def?.fala) return umaLinha(aplicarSlots(def.fala, node.slots, def.slots));
  if (node.id === 'livre.codigo-livre') return umaLinha((node.slots?.codigo || '').trim() || 'código livre');
  if (node.id === 'livre.comentario') return umaLinha(node.slots?.texto || 'comentário');
  const tpl = templateDe(def, node);
  const texto = aplicarSlots(tpl, node.slots, def?.slots).replace(/\{\{#\w+\}\}/g, '');
  return umaLinha(texto);
}

function umaLinha(texto: string): string {
  const linha = texto.replace(/\s+/g, ' ').trim();
  if (!linha) return '';
  return linha.length > 160 ? `${linha.slice(0, 157)}...` : linha;
}

function indentarFonte(raw: string, indent: number): string {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
  const pad = ' '.repeat(indent);
  return lines
    .map((line, i) => {
      if (!line.trim()) return '';
      if (i === 0) return pad + line.replace(/^\s+/, '');
      return line;
    })
    .filter((line, i, arr) => line !== '' || (i > 0 && i < arr.length - 1))
    .join('\n');
}

function emitir(node: FlowNode, defs: Map<string, BlockDef>, indent: number): string {
  if (node.pristine === true && typeof node.source === 'string' && node.source.length) {
    return indentarFonte(node.source, indent);
  }
  if (node.id === 'livre.codigo-livre') return indentarFonte(node.slots?.codigo || '', indent);
  if (node.id === 'livre.comentario') {
    const texto = String(node.slots?.texto || '').replace(/\s+/g, ' ').trim();
    return `${' '.repeat(indent)}// ${texto}`;
  }
  const def = defs.get(node.id);
  return preencher(templateDe(def, node), node, defs, indent);
}

function preencher(tpl: string, node: FlowNode, defs: Map<string, BlockDef>, indent: number): string {
  const childIndent = indent + 4;
  let text = String(tpl || '');
  text = text.replace(/^[ \t]*\{\{#(\w+)\}\}[ \t]*$/gm, (_, name: string) => {
    const kids = (node.children && node.children[name]) || [];
    if (!kids.length) return '';
    return kids.map((k) => `\u0000${emitir(k, defs, childIndent)}`).join('\n');
  });
  text = text.replace(/\{\{(\w+)\??\}\}/g, (_, name: string) => {
    const slots = node.slots || {};
    if (slots[name] == null) return '';
    return String(slots[name]);
  });
  const pad = ' '.repeat(indent);
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('\u0000')) out.push(line.slice(1));
    else if (line.trim()) out.push(pad + line.replace(/^\s+/, ''));
  }
  return out.join('\n');
}

export function previsualizarMetodo(method: FlowMethod, defs: Map<string, BlockDef>): string {
  const corpo = method.blocks.map((b) => emitir(b, defs, 2)).filter((t) => t.trim().length > 0).join('\n');
  const asyncKw = method.async ? 'async ' : '';
  const params = method.params ?? '';
  const miolo = corpo || '  ';
  return `${asyncKw}${method.name}(${params}) {\n${miolo}\n}`;
}

export function placaNova(def: BlockDef): FlowNode {
  const slots: Record<string, string> = {};
  for (const s of def.slots || []) slots[s.name] = s.padrao || '';
  const children: Record<string, FlowNode[]> = {};
  for (const c of def.containers || []) children[c.name] = [];
  return {
    id: def.id,
    variant: null,
    geracao: def.geracao ?? null,
    slots,
    children,
    pristine: false,
  };
}

function nomesLe(def: BlockDef): string[] | null {
  if (!Array.isArray(def.le)) return null;
  return def.le
    .map((item) => (typeof item === 'string' ? item : item?.name || ''))
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

/** O slot e lido (nao so declarado) pelo template. */
function slotEhLeitura(template: string, name: string): boolean {
  const marca = `{{${name}`;
  if (!template.includes(marca)) return false;
  const decl = new RegExp(`(?:const|let|var|catch\\s*\\()\\s*\\{\\{${name}\\??\\}\\}`);
  return template.replace(decl, '').includes(marca);
}

/** O que a placa da biblioteca ainda nao encontra em params + declarados. */
export function faltandoNoContexto(def: BlockDef, disponiveis: Set<string> | null): string[] {
  if (!disponiveis) return [];
  const explicitos = nomesLe(def);
  if (explicitos) return explicitos.filter((n) => !disponiveis.has(n));
  const tpl = def.template || '';
  const falta: string[] = [];
  for (const s of def.slots || []) {
    if (s.tipo !== 'variavel' || s.direcao !== 'entrada') continue;
    if (!slotEhLeitura(tpl, s.name)) continue;
    const nome = (s.padrao || '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(nome)) {
      if (!disponiveis.has(nome)) falta.push(nome);
    } else {
      falta.push(s.label || s.name);
    }
  }
  return falta;
}

export type Caminho = Array<number | string>;

export function alterarLista(blocks: FlowNode[], caminho: Caminho, fn: (lista: FlowNode[]) => FlowNode[]): FlowNode[] {
  if (caminho.length === 0) return fn(blocks);
  const [idx, cont, ...resto] = caminho;
  if (typeof idx !== 'number') return blocks;
  const nome = String(cont);
  return blocks.map((n, i) => {
    if (i !== idx) return n;
    const children = { ...(n.children || {}) };
    children[nome] = alterarLista(children[nome] || [], resto, fn);
    return { ...n, children, pristine: false };
  });
}

export function alterarNo(blocks: FlowNode[], caminho: Caminho, fn: (n: FlowNode) => FlowNode): FlowNode[] {
  const [head, ...tail] = caminho;
  if (typeof head !== 'number') return blocks;
  if (tail.length === 0) return blocks.map((n, i) => (i === head ? fn(n) : n));
  const cont = String(tail[0]);
  const resto = tail.slice(1);
  return blocks.map((n, i) => {
    if (i !== head) return n;
    const children = { ...(n.children || {}) };
    children[cont] = alterarNo(children[cont] || [], resto, fn);
    return { ...n, children, pristine: false };
  });
}
