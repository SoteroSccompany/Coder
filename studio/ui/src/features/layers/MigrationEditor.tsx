import { useState } from 'react';
import { ApiError } from '../../api/client';
import { studioActions } from '../../state/store';
import type { EditorProps } from '../editors/types';
import { layersApi } from './api';
import { AlternarTexto } from './AlternarTexto';
import './layers.css';

interface Coluna {
  name: string;
  type: string;
  length: string;
  pk: boolean;
  nullable: boolean;
}

const TIPOS = ['string', 'text', 'integer', 'bigInteger', 'boolean', 'datetime', 'timestamp', 'date', 'json', 'float', 'decimal'];

const vazia = (): Coluna => ({ name: '', type: 'string', length: '', pk: false, nullable: false });

export function MigrationEditor(props: EditorProps) {
  return (
    <AlternarTexto {...props}>
      <Designer {...props} />
    </AlternarTexto>
  );
}

function Designer({ projectId, path }: EditorProps) {
  const [table, setTable] = useState('tab_');
  const [colunas, setColunas] = useState<Coluna[]>([{ name: 'id', type: 'string', length: '39', pk: true, nullable: false }]);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function atualizar(i: number, patch: Partial<Coluna>) {
    setColunas((lista) => lista.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  async function gerar() {
    setErro(null);
    setMsg(null);
    try {
      const res = await layersApi.criarMigration(projectId, {
        table: table.trim(),
        columns: colunas.map((c) => ({
          name: c.name.trim(),
          type: c.type,
          length: c.length ? Number(c.length) : undefined,
          pk: c.pk,
          nullable: c.nullable,
        })),
      });
      setMsg(`Migration criada: ${res.path}`);
      studioActions.log('info', `Migration ${res.path}`, { projectId, source: 'layers' });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="ly-body">
      <h3>Designer de tabela</h3>
      <p className="ly-msg">Gera um arquivo novo em knex/migrations. Arquivo aberto: {path}</p>
      <label>
        Tabela
        <input value={table} onChange={(e) => setTable(e.target.value)} />
      </label>
      <div className="ly-colunas">
        {colunas.map((col, i) => (
          <div className="ly-row" key={i}>
            <label>
              Coluna
              <input value={col.name} onChange={(e) => atualizar(i, { name: e.target.value })} />
            </label>
            <label>
              Tipo
              <select value={col.type} onChange={(e) => atualizar(i, { type: e.target.value })}>
                {TIPOS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Tamanho
              <input value={col.length} onChange={(e) => atualizar(i, { length: e.target.value })} />
            </label>
            <label>
              PK
              <input type="checkbox" checked={col.pk} onChange={(e) => atualizar(i, { pk: e.target.checked })} />
            </label>
            <label>
              Nulo
              <input type="checkbox" checked={col.nullable} onChange={(e) => atualizar(i, { nullable: e.target.checked })} />
            </label>
            <button type="button" className="ly-danger" onClick={() => setColunas((lista) => lista.filter((_, idx) => idx !== i))}>
              Remover
            </button>
          </div>
        ))}
      </div>
      <div className="ly-actions">
        <button type="button" className="ly-ghost" onClick={() => setColunas((lista) => [...lista, vazia()])}>Adicionar coluna</button>
        <button type="button" onClick={() => void gerar()}>Gerar migration</button>
      </div>
      {msg && <p className="ly-msg ok">{msg}</p>}
      {erro && <p className="ly-msg erro">{erro}</p>}
    </div>
  );
}
