import { useEffect, useState } from 'react';
import { ApiError, ConflictError } from '../../api/client';
import { studioActions } from '../../state/store';
import type { EditorProps } from '../editors/types';
import { layersApi, type Campo, type CampoKind } from './api';
import { AlternarTexto } from './AlternarTexto';
import { NovaEntidade } from './NovaEntidade';
import './layers.css';

const KINDS: { id: CampoKind; label: string }[] = [
  { id: 'plain', label: 'valor (data.campo)' },
  { id: 'uuid', label: 'uuid se vazio' },
  { id: 'dateNow', label: 'data de agora se vazio' },
  { id: 'boolean', label: 'booleano (padrao false)' },
  { id: 'custom', label: 'expressao livre' },
];

export function DomainEditor(props: EditorProps) {
  return (
    <AlternarTexto {...props}>
      <Formulario {...props} />
    </AlternarTexto>
  );
}

function Formulario({ projectId, path }: EditorProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [erro, setErro] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [classe, setClasse] = useState<string | null>(null);
  const [getter, setGetter] = useState<string | null>(null);
  const [fields, setFields] = useState<Campo[]>([]);
  const [conflito, setConflito] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    setStatus('loading');
    setConflito(null);
    try {
      const doc = await layersApi.lerDomain(projectId, path);
      setHash(doc.hash);
      setClasse(doc.className);
      setGetter(doc.getter);
      setFields(doc.fields);
      setStatus('ready');
      setErro(null);
    } catch (e) {
      setStatus('error');
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void carregar();
    // recarrega quando o arquivo aberto muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path]);

  function atualizar(i: number, patch: Partial<Campo>) {
    setFields((lista) => lista.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  async function salvar() {
    if (!hash) return;
    setSalvando(true);
    setConflito(null);
    try {
      const doc = await layersApi.salvarDomain(projectId, path, fields, hash);
      setHash(doc.hash);
      setFields(doc.fields);
      setGetter(doc.getter);
      studioActions.log('info', `Domain salvo: ${path}`, { projectId, source: 'layers' });
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflito('O arquivo mudou no disco. Recarregue antes de salvar de novo.');
      } else {
        setErro(e instanceof ApiError ? e.message : String(e));
      }
    } finally {
      setSalvando(false);
    }
  }

  if (status === 'loading') return <div className="ly-body ly-msg">Carregando campos...</div>;
  if (status === 'error') return <div className="ly-body ly-msg erro">{erro}</div>;

  return (
    <div className="ly-body">
      <h3>
        {classe || 'Domain'} {getter ? `· ${getter}()` : ''}
      </h3>
      <p className="ly-msg">O salvamento atualiza o construtor e o metodo get. O restante do arquivo permanece.</p>
      {conflito && (
        <div className="banner banner-error">
          <span>{conflito}</span>
          <button type="button" onClick={() => void carregar()}>Recarregar do disco</button>
        </div>
      )}
      <div className="ly-colunas">
        {fields.map((campo, i) => (
          <div className="ly-row" key={`${campo.name}-${i}`}>
            <label>
              Campo
              <input value={campo.name} onChange={(e) => atualizar(i, { name: e.target.value })} />
            </label>
            <label>
              Tipo
              <select value={campo.kind} onChange={(e) => atualizar(i, { kind: e.target.value as CampoKind })}>
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>{k.label}</option>
                ))}
              </select>
            </label>
            {campo.kind === 'custom' && (
              <label>
                Expressao
                <input value={campo.expression || ''} onChange={(e) => atualizar(i, { expression: e.target.value })} />
              </label>
            )}
            <button type="button" className="ly-danger" onClick={() => setFields((lista) => lista.filter((_, idx) => idx !== i))}>
              Remover
            </button>
          </div>
        ))}
      </div>
      <div className="ly-actions">
        <button type="button" className="ly-ghost" onClick={() => setFields((lista) => [...lista, { name: 'novoCampo', kind: 'plain' }])}>
          Adicionar campo
        </button>
        <button type="button" disabled={salvando || fields.length === 0} onClick={() => void salvar()}>
          {salvando ? 'Salvando...' : 'Salvar domain'}
        </button>
      </div>
      {erro && status === 'ready' && <p className="ly-msg erro">{erro}</p>}
      <NovaEntidade projectId={projectId} />
    </div>
  );
}
