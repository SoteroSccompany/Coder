import { useEffect, useState } from 'react';
import { ApiError, ConflictError } from '../../api/client';
import { studioActions } from '../../state/store';
import type { EditorProps } from '../editors/types';
import { layersApi } from './api';
import { AlternarTexto } from './AlternarTexto';
import './layers.css';

const SNIPPETS = [
  { id: 'insert', label: 'insert' },
  { id: 'update', label: 'update' },
  { id: 'select', label: 'select' },
  { id: 'delete', label: 'delete' },
  { id: 'transaction', label: 'transaction' },
];

export function RepositoryEditor(props: EditorProps) {
  return (
    <AlternarTexto {...props}>
      <Formulario {...props} />
    </AlternarTexto>
  );
}

function Formulario({ projectId, path }: EditorProps) {
  const [hash, setHash] = useState<string | null>(null);
  const [table, setTable] = useState('');
  const [nome, setNome] = useState('');
  const [kind, setKind] = useState('insert');
  const [metodos, setMetodos] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  async function carregar() {
    setStatus('loading');
    try {
      const doc = await layersApi.lerRepo(projectId, path);
      setHash(doc.hash);
      setTable(doc.tableName || '');
      setMetodos(doc.methods.map((m) => m.name));
      setStatus('ready');
      setErro(null);
    } catch (e) {
      setStatus('error');
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path]);

  async function inserir() {
    if (!hash) return;
    setErro(null);
    setMsg(null);
    try {
      const res = await layersApi.inserirMetodo(projectId, path, {
        kind,
        name: nome.trim(),
        table: table.trim() || undefined,
        baseHash: hash,
      });
      setHash(res.hash);
      setTable(res.tableName);
      setMetodos((lista) => [...lista, res.name]);
      setMsg(`Metodo ${res.name} inserido (${res.kind}).`);
      studioActions.log('info', `Repositorio: metodo ${res.name}`, { projectId, source: 'layers' });
    } catch (e) {
      if (e instanceof ConflictError) setErro('O arquivo mudou no disco. Recarregue e tente de novo.');
      else setErro(e instanceof ApiError ? e.message : String(e));
    }
  }

  if (status === 'loading') return <div className="ly-body ly-msg">Carregando repositorio...</div>;
  if (status === 'error') return <div className="ly-body ly-msg erro">{erro}</div>;

  return (
    <div className="ly-body">
      <h3>Queries knex</h3>
      <p className="ly-msg">Gera um metodo e insere na classe. Metodos ja existentes: {metodos.join(', ') || 'nenhum'}.</p>
      <div className="ly-row">
        <label>
          Snippet
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {SNIPPETS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label>
          Metodo
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="inserirPedido" />
        </label>
        <label>
          Tabela
          <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="tab_pedido" />
        </label>
      </div>
      <div className="ly-actions">
        <button type="button" onClick={() => void inserir()}>Inserir metodo</button>
        <button type="button" className="ly-ghost" onClick={() => void carregar()}>Recarregar</button>
      </div>
      {msg && <p className="ly-msg ok">{msg}</p>}
      {erro && <p className="ly-msg erro">{erro}</p>}
    </div>
  );
}
