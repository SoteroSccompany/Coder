import { useState } from 'react';
import { ApiError } from '../../api/client';
import { studioActions } from '../../state/store';
import { layersApi } from './api';

export function NovaEntidade({ projectId }: { projectId: string }) {
  const [entity, setEntity] = useState('');
  const [table, setTable] = useState('');
  const [fields, setFields] = useState('id, nome');
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function criar() {
    setBusy(true);
    setErro(null);
    setMsg(null);
    try {
      const lista = fields.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await layersApi.criarEntidade(projectId, { entity: entity.trim(), table: table.trim(), fields: lista });
      setMsg(`Entidade ${res.entity} criada (${res.arquivos.length} arquivos).`);
      studioActions.log('info', `Nova entidade ${res.entity}`, { projectId, source: 'layers' });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details>
      <summary>Nova entidade</summary>
      <div className="ly-body">
        <div className="ly-row">
          <label>
            Entidade
            <input value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Pedido" />
          </label>
          <label>
            Tabela
            <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="tab_pedido" />
          </label>
        </div>
        <label>
          Campos (separados por virgula)
          <input value={fields} onChange={(e) => setFields(e.target.value)} />
        </label>
        <div className="ly-actions">
          <button type="button" disabled={busy} onClick={() => void criar()}>
            {busy ? 'Criando...' : 'Criar entidade'}
          </button>
        </div>
        {msg && <p className="ly-msg ok">{msg}</p>}
        {erro && <p className="ly-msg erro">{erro}</p>}
      </div>
    </details>
  );
}
