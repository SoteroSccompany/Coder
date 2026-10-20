// Editor da camada usecase. O HUD de placas e a tela inicial; Malha abre o Blockly e Codigo o Monaco.
// O Monaco padrao da fundacao continua acessivel pelo botao "Ver como texto" do cabecalho.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import * as Blockly from 'blockly';
import '../editor/monacoSetup';
import { useFileDocument } from '../editor/useFileDocument';
import { languageOf } from '../editor/languages';
import type { EditorProps } from '../editors/types';
import { ConflictError } from '../../api/client';
import { studioActions } from '../../state/store';
import { criarBloco, listarBiblioteca, obterFluxo, salvarFluxo } from './api';
import { caixaDeFerramentas, lerPilha, montarPilha, registrarBlocos } from './blocklyModel';
import { CreateBlockDialog } from './CreateBlockDialog';
import { HudView } from './hud/HudView';
import type { BlockDef, FlowNode, FlowResponse, ParamMarcado } from './types';
import './blocks.css';

type Modo = 'hud' | 'malha' | 'codigo';

export function BlocksEditor({ projectId, path }: EditorProps) {
  const doc = useFileDocument(projectId, path);
  const [modo, setModo] = useState<Modo>('hud');
  const [defs, setDefs] = useState<BlockDef[]>([]);
  const [fluxo, setFluxo] = useState<FlowResponse | null>(null);
  const [metodo, setMetodo] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [erro, setErro] = useState<string | null>(null);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [conflito, setConflito] = useState<{ currentHash: string | null; currentContent?: string } | null>(null);
  const [dialogo, setDialogo] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const sujoRef = useRef(false);
  const hidratando = useRef(false);
  const reloadRef = useRef(doc.reload);
  reloadRef.current = doc.reload;

  const defsMap = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);
  const atual = fluxo?.methods.find((m) => m.name === metodo) ?? null;

  const carregar = useCallback(async () => {
    setStatus('loading');
    try {
      const [lib, fl] = await Promise.all([listarBiblioteca(projectId), obterFluxo(projectId, path)]);
      setDefs(lib.blocks);
      setFluxo(fl);
      setMetodo((nome) => (nome && fl.methods.some((m) => m.name === nome) ? nome : fl.methods[0]?.name || ''));
      setErro(null);
      setConflito(null);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, path]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (modo !== 'malha' || status !== 'ready' || !hostRef.current) return undefined;
    hidratando.current = true;
    registrarBlocos(defs);
    const ws = Blockly.inject(hostRef.current, {
      toolbox: caixaDeFerramentas(defs),
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.9 },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    wsRef.current = ws;
    const ouvir = (ev: Blockly.Events.Abstract) => {
      if (hidratando.current || ev.isUiEvent) return;
      sujoRef.current = true;
      setSujo(true);
    };
    ws.addChangeListener(ouvir);
    return () => {
      ws.removeChangeListener(ouvir);
      ws.dispose();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [modo, status, defs]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || modo !== 'malha') return;
    hidratando.current = true;
    ws.clear();
    if (atual) montarPilha(ws, atual.blocks);
    sujoRef.current = false;
    setSujo(false);
    Blockly.svgResize(ws);
    hidratando.current = false;
  }, [atual, modo, defs]);

  useEffect(() => {
    const aoRedimensionar = () => {
      if (wsRef.current) Blockly.svgResize(wsRef.current);
    };
    window.addEventListener('resize', aoRedimensionar);
    return () => window.removeEventListener('resize', aoRedimensionar);
  }, []);

  const salvarBlocos = useCallback(
    async (hashForcado?: string) => {
      if (!fluxo || !atual) return;
      if (doc.dirty) {
        setErro('Salve ou descarte o codigo editado antes de gravar o fluxo.');
        return;
      }
      setSalvando(true);
      try {
        const blocks = modo === 'malha' && sujoRef.current && wsRef.current ? lerPilha(wsRef.current, defsMap) : atual.blocks;
        const res = await salvarFluxo(projectId, path, {
          method: atual.name,
          className: atual.className,
          blocks,
          baseHash: hashForcado ?? fluxo.hash,
        });
        setConflito(null);
        sujoRef.current = false;
        setSujo(false);
        await reloadRef.current();
        const novo = await obterFluxo(projectId, path);
        setFluxo(novo);
        const msg = res.unchanged ? `Fluxo sem alteracoes: ${path}` : `Fluxo salvo: ${path}`;
        studioActions.log('info', msg, { projectId, source: 'blocos' });
      } catch (e) {
        if (e instanceof ConflictError) {
          setConflito({ currentHash: e.currentHash, currentContent: e.currentContent });
          studioActions.log('warn', `Conflito ao salvar o fluxo de ${path}`, { projectId, source: 'blocos' });
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setErro(msg);
          studioActions.log('error', `Falha ao salvar fluxo: ${msg}`, { projectId, source: 'blocos' });
        }
      } finally {
        setSalvando(false);
      }
    },
    [fluxo, atual, doc.dirty, defsMap, projectId, path, modo],
  );

  const salvarRef = useRef(salvarBlocos);
  salvarRef.current = salvarBlocos;
  const salvarCodigoRef = useRef(doc.save);
  salvarCodigoRef.current = doc.save;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (modo === 'codigo') void salvarCodigoRef.current();
        else void salvarRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modo]);

  const aoMontarCodigo: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void salvarCodigoRef.current();
    });
  };

  const aoMontarSelecao: OnMount = (editor) => {
    editorRef.current = editor;
  };

  function mudarModo(proximo: Modo) {
    if (modo === 'malha' && proximo !== 'malha' && sujoRef.current && wsRef.current && fluxo && atual) {
      const blocks = lerPilha(wsRef.current, defsMap);
      setFluxo({
        ...fluxo,
        methods: fluxo.methods.map((m) => (m.name === atual.name && m.className === atual.className ? { ...m, blocks } : m)),
      });
    }
    setModo(proximo);
  }

  function gravarBlocosLocais(blocks: FlowNode[]) {
    setFluxo((fl) => {
      if (!fl || !atual) return fl;
      return {
        ...fl,
        methods: fl.methods.map((m) => (m.name === atual.name && m.className === atual.className ? { ...m, blocks } : m)),
      };
    });
    sujoRef.current = true;
    setSujo(true);
  }

  function transformarSelecao() {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const sel = editor?.getSelection();
    if (!editor || !model || !sel || sel.isEmpty()) {
      setErro('Selecione um trecho no codigo ao lado.');
      return;
    }
    setErro(null);
    setDialogo(model.getValueInRange(sel));
  }

  async function gravarBloco(body: {
    id: string;
    label: string;
    categoria: string;
    icone: string;
    params: ParamMarcado[];
    scope: 'project' | 'global';
  }) {
    if (!dialogo) return;
    await criarBloco(projectId, { ...body, code: dialogo });
    const lib = await listarBiblioteca(projectId);
    setDefs(lib.blocks);
    setDialogo(null);
    studioActions.log('info', `Bloco criado: ${body.id} (${body.scope === 'global' ? 'global' : 'projeto'})`, {
      projectId,
      source: 'blocos',
    });
  }

  if (status === 'loading' && doc.status === 'loading') return <div className="editor-msg">Carregando blocos de {path}...</div>;
  if (status === 'error') return <div className="editor-msg error">Erro: {erro}</div>;

  return (
    <div className="blocks-editor">
      <div className="blocks-toolbar">
        <div className="blocks-toggle">
          <button type="button" className={modo === 'hud' ? 'ativo' : ''} onClick={() => mudarModo('hud')}>
            HUD
          </button>
          <button type="button" className={modo === 'malha' ? 'ativo' : ''} onClick={() => mudarModo('malha')}>
            Malha
          </button>
          <button type="button" className={modo === 'codigo' ? 'ativo' : ''} onClick={() => mudarModo('codigo')}>
            Código
          </button>
        </div>
        {modo !== 'codigo' && (
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} aria-label="Metodo">
            {(fluxo?.methods || []).map((m) => (
              <option key={`${m.className || ''}.${m.name}`} value={m.name}>
                {m.async ? 'async ' : ''}
                {m.name}
                {m.params ? `(${m.params})` : '()'}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => void (modo === 'codigo' ? doc.save() : salvarBlocos())} disabled={salvando || doc.saving}>
          {salvando || doc.saving ? 'Salvando...' : 'Salvar'}
        </button>
        {modo === 'malha' && (
          <button type="button" className="blocks-ghost" onClick={transformarSelecao}>
            Transformar selecao em bloco
          </button>
        )}
        <span className="muted">{modo === 'codigo' ? (doc.dirty ? 'Codigo alterado' : 'Codigo salvo') : sujo ? 'Fluxo alterado' : 'Fluxo igual ao arquivo'}</span>
      </div>

      {modo === 'codigo' && doc.conflict && (
        <div className="banner banner-error" role="alert">
          <span>
            Conflito: <b>{path}</b> foi alterado no disco depois que voce abriu. Seu salvamento foi bloqueado.
          </span>
          <button type="button" onClick={() => void doc.reload()}>Recarregar do disco (descarta minhas alteracoes)</button>
          <button type="button" onClick={() => void doc.overwrite()}>Sobrescrever com minha versao</button>
        </div>
      )}
      {modo !== 'codigo' && conflito && (
        <div className="banner banner-error" role="alert">
          <span>
            Conflito: <b>{path}</b> mudou no disco. O fluxo nao foi gravado.
          </span>
          <button
            type="button"
            onClick={() => {
              setConflito(null);
              void carregar();
              void doc.reload();
            }}
          >
            Recarregar do disco (descarta minhas alteracoes)
          </button>
          <button type="button" onClick={() => conflito.currentHash && void salvarBlocos(conflito.currentHash)}>
            Sobrescrever com minha versao
          </button>
        </div>
      )}
      {!doc.conflict && !conflito && doc.externalChange && (
        <div className="banner banner-warn" role="alert">
          <span>{doc.externalChange.removed ? 'O arquivo foi removido do disco.' : 'O arquivo mudou no disco.'}</span>
          {!doc.externalChange.removed && (
            <button type="button" onClick={() => void doc.reload().then(() => carregar())}>
              Recarregar do disco
            </button>
          )}
          <button type="button" onClick={doc.dismissExternal}>Manter minha versao</button>
        </div>
      )}
      {modo !== 'codigo' && doc.dirty && (
        <div className="banner banner-warn" role="alert">
          <span>O codigo foi editado e ainda nao foi salvo. Salve ou descarte antes de gravar o fluxo.</span>
          <button type="button" onClick={() => void doc.save()}>Salvar codigo</button>
          <button type="button" onClick={() => void doc.reload()}>Descartar</button>
        </div>
      )}
      {erro && modo !== 'codigo' && <div className="banner banner-error">{erro}</div>}

      {modo === 'codigo' ? (
        <div className="monaco-wrap">
          <div className="monaco-host">
            <Editor
              path={`${projectId}::${path}::codigo`}
              language={languageOf(path)}
              value={doc.value}
              theme="vs-dark"
              onChange={(v) => doc.setValue(v ?? '')}
              onMount={aoMontarCodigo}
              options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 13, tabSize: 2 }}
            />
          </div>
        </div>
      ) : modo === 'malha' ? (
        <div className="blocks-main">
          <div className="blocks-canvas">
            <div className="blocks-canvas-host" ref={hostRef} />
          </div>
          <aside className="blocks-side">
            <div className="blocks-side-title">Codigo (selecione um trecho para criar um bloco)</div>
            <div className="monaco-host">
              <Editor
                path={`${projectId}::${path}::selecao`}
                language={languageOf(path)}
                value={doc.value}
                theme="vs-dark"
                onMount={aoMontarSelecao}
                options={{ readOnly: true, domReadOnly: true, automaticLayout: true, minimap: { enabled: false }, fontSize: 12, tabSize: 2 }}
              />
            </div>
          </aside>
        </div>
      ) : atual ? (
        <HudView projectId={projectId} path={path} defs={defs} method={atual} onChange={gravarBlocosLocais} />
      ) : (
        <div className="editor-msg">Nenhum metodo neste arquivo.</div>
      )}

      {dialogo != null && <CreateBlockDialog codigo={dialogo} onFechar={() => setDialogo(null)} onCriar={gravarBloco} />}
    </div>
  );
}
