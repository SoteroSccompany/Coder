// Bancada do use case: placas em sequencia, contexto do ponto, Jarvis e o voo.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { studioSocket } from '../../../api/client';
import { rotuloCategoria } from '../blocklyModel';
import type { BlockDef, FlowMethod, FlowNode } from '../types';
import {
  acionarRota,
  desligarProcesso,
  ligarProcesso,
  obterContexto,
  proporJarvis,
  testarArquivo,
  voarMetodo,
  type ContextoResposta,
  type JarvisResposta,
} from './api';
import {
  alterarLista,
  alterarNo,
  falaDaPlaca,
  faltandoNoContexto,
  parametrosDoMetodo,
  placaNova,
  previsualizarMetodo,
  type Caminho,
} from './preview';
import './hud.css';

type EstadoPlaca = 'ociosa' | 'voo' | 'ok' | 'falha';
type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface MenuInserir {
  caminho: Caminho;
  index: number;
}

interface LinhaLog {
  stream: string;
  line: string;
}

const ORDEM = ['fluxo', 'dados', 'seguranca', 'infra', 'livre'];
const COR: Record<string, string> = {
  fluxo: '#3d7ea6',
  dados: '#2f9e8f',
  seguranca: '#c47b4a',
  infra: '#8a6bb5',
  livre: '#a3a332',
};

const ROTULO_ESTADO: Record<EstadoPlaca, string> = {
  ociosa: 'Ociosa',
  voo: 'Em voo',
  ok: 'Ok',
  falha: 'Falha',
};

function chave(caminho: Caminho) {
  return caminho.join('/');
}

function cobre(selecao: Caminho | null, caminho: Caminho) {
  if (!selecao || selecao.length < caminho.length) return false;
  return caminho.every((passo, i) => selecao[i] === passo);
}

function textoCorpo(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function mensagem(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function HudView({
  projectId,
  path,
  defs,
  method,
  onChange,
}: {
  projectId: string;
  path: string;
  defs: BlockDef[];
  method: FlowMethod;
  onChange: (blocks: FlowNode[]) => void;
}) {
  const defsMap = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);
  const [selecao, setSelecao] = useState<Caminho | null>(null);
  const [menu, setMenu] = useState<MenuInserir | null>(null);
  const [ctx, setCtx] = useState<ContextoResposta | null>(null);
  const [ctxErro, setCtxErro] = useState<string | null>(null);
  const [menuCtx, setMenuCtx] = useState<Set<string> | null>(null);
  const [estados, setEstados] = useState<Record<number, EstadoPlaca>>({});
  const [sessao, setSessao] = useState<{ url: string; porta: number; pid: number } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [httpMetodo, setHttpMetodo] = useState<MetodoHttp>('GET');
  const [httpCaminho, setHttpCaminho] = useState('/healthcheck');
  const [httpJson, setHttpJson] = useState('{}');
  const [frase, setFrase] = useState('');
  const [proposta, setProposta] = useState<JarvisResposta | null>(null);
  const [linhas, setLinhas] = useState<LinhaLog[]>([]);
  const [resposta, setResposta] = useState<string | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);
  const blocosRef = useRef(method.blocks);
  blocosRef.current = method.blocks;

  const preview = useMemo(() => previsualizarMetodo(method, defsMap), [method, defsMap]);
  const indiceTopo = selecao && typeof selecao[0] === 'number' ? selecao[0] : null;

  useEffect(() => {
    setSelecao(null);
    setMenu(null);
    setEstados({});
    setProposta(null);
  }, [path, method.name, method.className]);

  useEffect(() => {
    let vivo = true;
    const timer = window.setTimeout(() => {
      const index = indiceTopo == null ? method.blocks.length : indiceTopo;
      obterContexto(projectId, { blocks: method.blocks, params: parametrosDoMetodo(method.params), index })
        .then((r) => {
          if (!vivo) return;
          setCtx(r);
          setCtxErro(null);
        })
        .catch((e) => {
          if (!vivo) return;
          setCtx(null);
          setCtxErro(mensagem(e));
        });
    }, 250);
    return () => {
      vivo = false;
      window.clearTimeout(timer);
    };
  }, [projectId, method, indiceTopo]);

  useEffect(() => {
    if (!menu) {
      setMenuCtx(null);
      return undefined;
    }
    let vivo = true;
    const topo = menu.caminho.length === 0 ? menu.index : typeof menu.caminho[0] === 'number' ? menu.caminho[0] + 1 : menu.index;
    const index = Math.max(0, Math.min(topo, method.blocks.length));
    obterContexto(projectId, { blocks: method.blocks, params: parametrosDoMetodo(method.params), index })
      .then((r) => {
        if (vivo) setMenuCtx(new Set([...r.params, ...r.declarados]));
      })
      .catch(() => {
        if (vivo) setMenuCtx(null);
      });
    return () => {
      vivo = false;
    };
  }, [menu, projectId, method]);

  useEffect(() => {
    const offLog = studioSocket.on('run:log', (msg) => {
      if (msg.projectId !== projectId) return;
      const p = msg.payload as { stream?: string; line?: string };
      const line = p.line ?? '';
      if (!line) return;
      setLinhas((atual) => [...atual.slice(-399), { stream: p.stream || 'stdout', line }]);
    });
    const offTrace = studioSocket.on('run:trace', (msg) => {
      if (msg.projectId !== projectId) return;
      const p = msg.payload as { index?: number; ok?: boolean };
      if (typeof p.index !== 'number') return;
      const ok = p.ok !== false;
      const total = blocosRef.current.length;
      const index = p.index;
      setEstados((atual) => {
        const next = { ...atual, [index]: (ok ? 'ok' : 'falha') as EstadoPlaca };
        if (ok && index + 1 < total) next[index + 1] = 'voo';
        return next;
      });
    });
    return () => {
      offLog();
      offTrace();
    };
  }, [projectId]);

  useEffect(() => {
    const el = logsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [linhas, resposta]);

  function aplicar(blocks: FlowNode[]) {
    onChange(blocks);
  }

  function mudarSlot(caminho: Caminho, nome: string, valor: string) {
    aplicar(
      alterarNo(method.blocks, caminho, (n) => ({
        ...n,
        pristine: false,
        slots: { ...(n.slots || {}), [nome]: valor },
      })),
    );
  }

  function tirar(caminho: Caminho) {
    const index = caminho[caminho.length - 1];
    if (typeof index !== 'number') return;
    const lista = caminho.slice(0, -1);
    aplicar(alterarLista(method.blocks, lista, (nos) => nos.filter((_, i) => i !== index)));
    setSelecao(null);
  }

  function encaixar(def: BlockDef) {
    if (!menu) return;
    aplicar(
      alterarLista(method.blocks, menu.caminho, (nos) => {
        const next = nos.slice();
        next.splice(menu.index, 0, placaNova(def));
        return next;
      }),
    );
    setMenu(null);
  }

  function lerEntrada(): unknown | undefined {
    const t = httpJson.trim();
    if (!t) return undefined;
    return JSON.parse(t);
  }

  async function aoLigar() {
    setOcupado('ligar');
    try {
      const r = await ligarProcesso(projectId);
      setSessao({ url: r.url, porta: r.porta, pid: r.pid });
      setResposta(`Ligado em ${r.url} (pid ${r.pid})`);
    } catch (e) {
      setResposta(mensagem(e));
    } finally {
      setOcupado(null);
    }
  }

  async function aoDesligar() {
    setOcupado('desligar');
    try {
      await desligarProcesso(projectId);
      setSessao(null);
      setResposta('Processo encerrado');
    } catch (e) {
      setResposta(mensagem(e));
    } finally {
      setOcupado(null);
    }
  }

  async function aoAcionar() {
    let body: unknown;
    try {
      body = lerEntrada();
    } catch {
      setResposta('JSON invalido');
      return;
    }
    if (!httpCaminho.trim()) {
      setResposta('Informe o caminho');
      return;
    }
    setOcupado('acionar');
    try {
      const r = await acionarRota(projectId, { method: httpMetodo, path: httpCaminho.trim(), body });
      setResposta(`HTTP ${r.status} em ${r.ms} ms\n${textoCorpo(r.body)}`);
    } catch (e) {
      setResposta(mensagem(e));
    } finally {
      setOcupado(null);
    }
  }

  async function aoVoo() {
    let input: unknown;
    try {
      input = lerEntrada();
    } catch {
      setResposta('JSON invalido');
      return;
    }
    const total = method.blocks.length;
    setEstados(total ? { 0: 'voo' } : {});
    setOcupado('voo');
    try {
      const r = await voarMetodo(projectId, {
        path,
        method: method.name,
        className: method.className,
        input,
      });
      const mapa: Record<number, EstadoPlaca> = {};
      for (const p of r.passos) mapa[p.index] = p.ok ? 'ok' : 'falha';
      setEstados(mapa);
      const falha = r.passos.find((p) => !p.ok);
      setResposta(
        falha
          ? `Voo parou na placa ${falha.index + 1}: ${falha.error || 'falha'}`
          : `Voo concluido (${r.passos.length} placas)`,
      );
    } catch (e) {
      setResposta(mensagem(e));
    } finally {
      setOcupado(null);
    }
  }

  async function aoTestar() {
    setEstados({});
    setOcupado('testar');
    try {
      const r = await testarArquivo(projectId, { path });
      if (r.placa) setEstados({ [r.placa.index]: 'falha' });
      const pedacos = [`Teste ${r.ok ? 'ok' : 'falhou'} (codigo ${r.code})`];
      if (r.stdout) pedacos.push(r.stdout);
      if (r.stderr) pedacos.push(r.stderr);
      setResposta(pedacos.join('\n'));
    } catch (e) {
      setResposta(mensagem(e));
    } finally {
      setOcupado(null);
    }
  }

  async function aoJarvis() {
    const texto = frase.trim();
    if (!texto) return;
    const index =
      indiceTopo == null ? Math.max(0, method.blocks.length - 1) : indiceTopo;
    setOcupado('jarvis');
    try {
      const r = await proporJarvis(projectId, { frase: texto, index });
      setProposta(r);
    } catch (e) {
      setResposta(mensagem(e));
    } finally {
      setOcupado(null);
    }
  }

  function confirmarJarvis() {
    if (!proposta) return;
    const pos = Math.max(0, Math.min(proposta.posicao, method.blocks.length));
    const placas = proposta.placas.map((p) => ({
      ...p,
      slots: p.slots || {},
      children: p.children || {},
      pristine: p.pristine === true,
    }));
    const next = method.blocks.slice();
    next.splice(pos, 0, ...placas);
    aplicar(next);
    setProposta(null);
    setFrase('');
  }

  const grupos = useMemo(() => {
    const mapa = new Map<string, BlockDef[]>();
    for (const d of defs) {
      const cat = d.categoria || 'livre';
      const lista = mapa.get(cat) || [];
      lista.push(d);
      mapa.set(cat, lista);
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.label.localeCompare(b.label, 'pt'));
    }
    return [...mapa.keys()].sort((a, b) => {
      const ia = ORDEM.indexOf(a);
      const ib = ORDEM.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'pt');
    }).map((cat) => ({ cat, itens: mapa.get(cat) || [] }));
  }, [defs]);

  return (
    <div className="hud">
      <div className="hud-corpo">
        <div className="hud-placas">
          <h2 className="hud-coluna-titulo">
            {method.className ? `${method.className}.` : ''}
            {method.name}
          </h2>
          <Sequencia
            nos={method.blocks}
            prefixo={[]}
            defsMap={defsMap}
            estados={estados}
            selecao={selecao}
            menu={menu}
            grupos={grupos}
            disponiveis={menuCtx}
            onSelecionar={setSelecao}
            onMenu={setMenu}
            onSlot={mudarSlot}
            onTirar={tirar}
            onEncaixar={encaixar}
          />
        </div>
        <aside className="hud-lateral">
          <h2 className="hud-coluna-titulo">Contexto</h2>
          {ctxErro && <p className="hud-vazio">Contexto indisponivel.</p>}
          <ListaNomes titulo="Parâmetros" nomes={ctx?.params || []} />
          <ListaNomes titulo="Declarados" nomes={ctx?.declarados || []} />
          <ListaNomes titulo="Lê" nomes={ctx?.le || []} />
          <ListaNomes titulo="Produz" nomes={ctx?.produz || []} />
        </aside>
        <aside className="hud-js">
          <h3>JavaScript</h3>
          <p className="hud-vazio">Prévia do fluxo em memória</p>
          <pre className="hud-codigo">{preview}</pre>
        </aside>
      </div>

      <div className="hud-barra">
        <button type="button" onClick={() => void aoLigar()} disabled={ocupado != null}>
          Ligar
        </button>
        <button type="button" className="hud-sec" onClick={() => void aoDesligar()} disabled={ocupado != null}>
          Desligar
        </button>
        <span className={`hud-sessao ${sessao ? 'ligado' : ''}`}>{sessao ? sessao.url : 'Desligado'}</span>
        <label>
          Metodo
          <select value={httpMetodo} onChange={(e) => setHttpMetodo(e.target.value as MetodoHttp)} aria-label="Metodo HTTP">
            {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as MetodoHttp[]).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Caminho
          <input className="hud-caminho" value={httpCaminho} onChange={(e) => setHttpCaminho(e.target.value)} aria-label="Caminho HTTP" />
        </label>
        <label>
          JSON
          <input className="hud-json" value={httpJson} onChange={(e) => setHttpJson(e.target.value)} aria-label="JSON" spellCheck={false} />
        </label>
        <button type="button" onClick={() => void aoAcionar()} disabled={ocupado != null}>
          Acionar
        </button>
        <button type="button" className="hud-sec" onClick={() => void aoVoo()} disabled={ocupado != null}>
          Voo
        </button>
        <button type="button" className="hud-sec" onClick={() => void aoTestar()} disabled={ocupado != null}>
          Testar
        </button>
        <label>
          Jarvis
          <input
            className="hud-jarvis"
            value={frase}
            placeholder="guarda, devolve, busca usuario..."
            aria-label="Frase do Jarvis"
            onChange={(e) => setFrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void aoJarvis();
            }}
          />
        </label>
        <button type="button" onClick={() => void aoJarvis()} disabled={ocupado != null || !frase.trim()}>
          Propor
        </button>
        {proposta && (
          <div className="hud-cartao">
            <strong>Vou encaixar isto</strong>
            {proposta.fala && <p>{proposta.fala}</p>}
            <ol>
              {proposta.placas.map((p, i) => (
                <li key={`${p.id}-${i}`}>{defsMap.get(p.id)?.label || p.id}</li>
              ))}
            </ol>
            <p className="hud-vazio">Posicao {proposta.posicao + 1}</p>
            <div className="hud-cartao-acoes">
              <button type="button" onClick={confirmarJarvis}>
                Encaixar
              </button>
              <button type="button" className="hud-sec" onClick={() => setProposta(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="hud-console">
        <div className="hud-console-topo">
          <span>Console</span>
          <button
            type="button"
            onClick={() => {
              setLinhas([]);
              setResposta(null);
            }}
          >
            Limpar
          </button>
        </div>
        {resposta && <pre className="hud-resposta">{resposta}</pre>}
        <div className="hud-logs" ref={logsRef}>
          {linhas.map((l, i) => (
            <div key={`${i}-${l.line.slice(0, 12)}`} className={l.stream === 'stderr' ? 'stderr' : ''}>
              {l.stream}: {l.line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ListaNomes({ titulo, nomes }: { titulo: string; nomes: string[] }) {
  return (
    <section>
      <h3>{titulo}</h3>
      {nomes.length === 0 ? (
        <p className="hud-vazio">nenhum</p>
      ) : (
        <ul>
          {nomes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Sequencia({
  nos,
  prefixo,
  defsMap,
  estados,
  selecao,
  menu,
  grupos,
  disponiveis,
  onSelecionar,
  onMenu,
  onSlot,
  onTirar,
  onEncaixar,
}: {
  nos: FlowNode[];
  prefixo: Caminho;
  defsMap: Map<string, BlockDef>;
  estados: Record<number, EstadoPlaca>;
  selecao: Caminho | null;
  menu: MenuInserir | null;
  grupos: { cat: string; itens: BlockDef[] }[];
  disponiveis: Set<string> | null;
  onSelecionar: (c: Caminho) => void;
  onMenu: (m: MenuInserir | null) => void;
  onSlot: (caminho: Caminho, nome: string, valor: string) => void;
  onTirar: (caminho: Caminho) => void;
  onEncaixar: (def: BlockDef) => void;
}) {
  const topo = prefixo.length === 0;
  return (
    <div className="hud-seq">
      {nos.map((node, i) => {
        const caminho: Caminho = [...prefixo, i];
        const estado: EstadoPlaca = topo ? estados[i] || 'ociosa' : 'ociosa';
        return (
          <div key={chave(caminho)}>
            <Mais
              aberto={menu != null && chave(menu.caminho) === chave(prefixo) && menu.index === i}
              onClick={() => onMenu({ caminho: prefixo, index: i })}
            />
            {menu && chave(menu.caminho) === chave(prefixo) && menu.index === i && (
              <Biblioteca grupos={grupos} disponiveis={disponiveis} onFechar={() => onMenu(null)} onEscolher={onEncaixar} />
            )}
            <Placa
              node={node}
              caminho={caminho}
              def={defsMap.get(node.id)}
              estado={estado}
              ativa={selecao != null && chave(selecao) === chave(caminho)}
              onSelecionar={() => onSelecionar(caminho)}
              onSlot={onSlot}
              onTirar={() => onTirar(caminho)}
              filhos={
                <Filhos
                  node={node}
                  caminho={caminho}
                  defsMap={defsMap}
                  estados={estados}
                  selecao={selecao}
                  menu={menu}
                  grupos={grupos}
                  disponiveis={disponiveis}
                  onSelecionar={onSelecionar}
                  onMenu={onMenu}
                  onSlot={onSlot}
                  onTirar={onTirar}
                  onEncaixar={onEncaixar}
                />
              }
            />
          </div>
        );
      })}
      <Mais
        aberto={menu != null && chave(menu.caminho) === chave(prefixo) && menu.index === nos.length}
        onClick={() => onMenu({ caminho: prefixo, index: nos.length })}
      />
      {menu && chave(menu.caminho) === chave(prefixo) && menu.index === nos.length && (
        <Biblioteca grupos={grupos} disponiveis={disponiveis} onFechar={() => onMenu(null)} onEscolher={onEncaixar} />
      )}
      {nos.length === 0 && prefixo.length === 0 && <p className="hud-vazio">Nenhuma placa neste metodo.</p>}
    </div>
  );
}

function Filhos(props: {
  node: FlowNode;
  caminho: Caminho;
  defsMap: Map<string, BlockDef>;
  estados: Record<number, EstadoPlaca>;
  selecao: Caminho | null;
  menu: MenuInserir | null;
  grupos: { cat: string; itens: BlockDef[] }[];
  disponiveis: Set<string> | null;
  onSelecionar: (c: Caminho) => void;
  onMenu: (m: MenuInserir | null) => void;
  onSlot: (caminho: Caminho, nome: string, valor: string) => void;
  onTirar: (caminho: Caminho) => void;
  onEncaixar: (def: BlockDef) => void;
}) {
  const def = props.defsMap.get(props.node.id);
  const containers = def?.containers || [];
  if (!containers.length) return null;
  if (!cobre(props.selecao, props.caminho)) return null;
  return (
    <>
      {containers.map((c) => (
        <div key={c.name} className="hud-aninhado">
          <h2 className="hud-coluna-titulo">{c.label || c.name}</h2>
          <Sequencia
            nos={props.node.children?.[c.name] || []}
            prefixo={[...props.caminho, c.name]}
            defsMap={props.defsMap}
            estados={props.estados}
            selecao={props.selecao}
            menu={props.menu}
            grupos={props.grupos}
            disponiveis={props.disponiveis}
            onSelecionar={props.onSelecionar}
            onMenu={props.onMenu}
            onSlot={props.onSlot}
            onTirar={props.onTirar}
            onEncaixar={props.onEncaixar}
          />
        </div>
      ))}
    </>
  );
}

function Placa({
  node,
  caminho,
  def,
  estado,
  ativa,
  onSelecionar,
  onSlot,
  onTirar,
  filhos,
}: {
  node: FlowNode;
  caminho: Caminho;
  def: BlockDef | undefined;
  estado: EstadoPlaca;
  ativa: boolean;
  onSelecionar: () => void;
  onSlot: (caminho: Caminho, nome: string, valor: string) => void;
  onTirar: () => void;
  filhos: ReactNode;
}) {
  const cor = COR[def?.categoria || 'livre'] || '#3d7ea6';
  const slots = def?.slots || [];
  return (
    <article
      className={`hud-placa ${ativa ? 'ativa' : ''} ${estado}`}
      style={{ borderLeftColor: cor }}
      onClick={(e) => {
        e.stopPropagation();
        onSelecionar();
      }}
    >
      <span className={`hud-ponto ${estado}`} title={ROTULO_ESTADO[estado]} />
      <h3>{def?.label || node.id}</h3>
      <p className="hud-fala">{falaDaPlaca(def, node)}</p>
      {ativa && slots.length > 0 && (
        <div className="hud-slots" onClick={(e) => e.stopPropagation()}>
          {slots.map((s) => {
            const valor = node.slots?.[s.name] ?? '';
            const id = `slot-${chave(caminho)}-${s.name}`;
            if (s.tipo === 'codigo' || s.name === 'codigo') {
              return (
                <label key={s.name} htmlFor={id}>
                  {s.label || s.name}
                  <textarea id={id} value={valor} spellCheck={false} onChange={(e) => onSlot(caminho, s.name, e.target.value)} />
                </label>
              );
            }
            if (s.opcoes && s.opcoes.length) {
              return (
                <label key={s.name} htmlFor={id}>
                  {s.label || s.name}
                  <select id={id} value={valor} onChange={(e) => onSlot(caminho, s.name, e.target.value)}>
                    {!s.opcoes.includes(valor) && valor !== '' && <option value={valor}>{valor}</option>}
                    {s.opcoes.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            return (
              <label key={s.name} htmlFor={id}>
                {s.label || s.name}
                <input id={id} value={valor} onChange={(e) => onSlot(caminho, s.name, e.target.value)} />
              </label>
            );
          })}
          <div className="hud-placa-acoes">
            <button type="button" className="hud-sec" onClick={onTirar}>
              Tirar
            </button>
          </div>
        </div>
      )}
      {ativa && slots.length === 0 && (
        <div className="hud-placa-acoes" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="hud-sec" onClick={onTirar}>
            Tirar
          </button>
        </div>
      )}
      {filhos}
    </article>
  );
}

function Mais({ aberto, onClick }: { aberto: boolean; onClick: () => void }) {
  return (
    <div className="hud-mais">
      <button
        type="button"
        className={aberto ? 'aberto' : ''}
        aria-label="Encaixar placa"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        +
      </button>
    </div>
  );
}

function Biblioteca({
  grupos,
  disponiveis,
  onFechar,
  onEscolher,
}: {
  grupos: { cat: string; itens: BlockDef[] }[];
  disponiveis: Set<string> | null;
  onFechar: () => void;
  onEscolher: (def: BlockDef) => void;
}) {
  return (
    <div className="hud-lib" onClick={(e) => e.stopPropagation()}>
      <div className="hud-lib-topo">
        <span>Biblioteca</span>
        <button type="button" onClick={onFechar}>
          Fechar
        </button>
      </div>
      {grupos.length === 0 && <p className="hud-vazio">Biblioteca vazia.</p>}
      {grupos.map((g) => (
        <div key={g.cat}>
          <h4>{rotuloCategoria(g.cat)}</h4>
          {g.itens.map((d) => {
            const falta = faltandoNoContexto(d, disponiveis);
            return (
              <button
                type="button"
                key={d.id}
                className={`hud-lib-item ${falta.length ? 'fraca' : ''}`}
                onClick={() => onEscolher(d)}
              >
                <span>{d.label}</span>
                {falta.length > 0 && <small>falta: {falta.join(', ')}</small>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
