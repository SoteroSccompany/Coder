import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { studioActions } from '../../state/store';
import type { EditorProps } from '../editors/types';
import { layersApi } from './api';
import { AlternarTexto } from './AlternarTexto';
import './layers.css';

export function WorkerEditor(props: EditorProps) {
  return (
    <AlternarTexto {...props}>
      <Formulario {...props} />
    </AlternarTexto>
  );
}

function Formulario({ projectId }: EditorProps) {
  const [workers, setWorkers] = useState<string[]>([]);
  const [nome, setNome] = useState('');
  const [fila, setFila] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function carregar() {
    try {
      const res = await layersApi.listarWorkers(projectId);
      setWorkers(res.workers);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function criar() {
    setErro(null);
    setMsg(null);
    try {
      const res = await layersApi.criarWorker(projectId, nome.trim(), fila.trim());
      setMsg(`Consumidor criado em ${res.path}`);
      studioActions.log('info', `Worker ${res.path}`, { projectId, source: 'layers' });
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="ly-body">
      <h3>Consumidor de fila</h3>
      <p className="ly-msg">Cria um esqueleto real em infrastructure/queue/workers (ou na pasta da camada worker).</p>
      <ul>
        {workers.map((w) => (
          <li key={w}>{w}</li>
        ))}
        {workers.length === 0 && <li className="ly-msg">Nenhum consumidor ainda.</li>}
      </ul>
      <div className="ly-row">
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Pedido" />
        </label>
        <label>
          Fila
          <input value={fila} onChange={(e) => setFila(e.target.value)} placeholder="fila.pedido" />
        </label>
      </div>
      <div className="ly-actions">
        <button type="button" onClick={() => void criar()}>Criar consumidor</button>
      </div>
      {msg && <p className="ly-msg ok">{msg}</p>}
      {erro && <p className="ly-msg erro">{erro}</p>}
    </div>
  );
}
