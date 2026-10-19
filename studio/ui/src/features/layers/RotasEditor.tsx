import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { studioActions } from '../../state/store';
import type { EditorProps } from '../editors/types';
import { layersApi, type RotaLinha, type RotasView } from './api';
import { AlternarTexto } from './AlternarTexto';
import './layers.css';

const METODOS = ['get', 'post', 'put', 'patch', 'delete'];

export function RotasEditor(props: EditorProps) {
  return (
    <AlternarTexto {...props}>
      <Tabela {...props} />
    </AlternarTexto>
  );
}

function Tabela({ projectId, path }: EditorProps) {
  const [view, setView] = useState<RotasView | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [file, setFile] = useState(path);
  const [method, setMethod] = useState('get');
  const [caminho, setCaminho] = useState('/');
  const [handler, setHandler] = useState('');
  const [controllerPath, setControllerPath] = useState('');

  async function carregar() {
    try {
      const doc = await layersApi.lerRotas(projectId);
      setView(doc);
      setErro(null);
      const arquivos = Object.keys(doc.arquivos);
      const preferido = arquivos.includes(path) ? path : arquivos.find((a) => a.includes('/routes/')) || arquivos[0] || path;
      setFile(preferido);
      if (!controllerPath && doc.controllers[0]) setControllerPath(doc.controllers[0].file);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path]);

  async function adicionar() {
    if (!view) return;
    setMsg(null);
    try {
      const res = await layersApi.salvarRota(projectId, {
        action: 'add',
        file,
        method,
        path: caminho,
        handler: handler.trim(),
        controllerPath: controllerPath || undefined,
        baseHash: view.arquivos[file]?.hash,
        controllerBaseHash: controllerPath ? view.arquivos[controllerPath]?.hash : undefined,
      });
      setMsg(res.aviso || (res.criada ? 'Rota acrescentada.' : 'A rota ja existia.'));
      studioActions.log('info', `Rota ${method.toUpperCase()} ${caminho}`, { projectId, source: 'layers' });
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function remover(rota: RotaLinha) {
    if (!view) return;
    try {
      await layersApi.salvarRota(projectId, {
        action: 'remove',
        file: rota.file,
        method: rota.method,
        path: rota.path,
        handler: rota.handler,
        baseHash: view.arquivos[rota.file]?.hash,
      });
      studioActions.log('info', `Rota removida ${rota.method} ${rota.path}`, { projectId, source: 'layers' });
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="ly-body">
      <h3>Rotas e handlers</h3>
      {erro && <p className="ly-msg erro">{erro}</p>}
      <table>
        <thead>
          <tr>
            <th>Metodo</th>
            <th>Caminho</th>
            <th>Handler</th>
            <th>Arquivo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(view?.rotas || []).map((rota) => (
            <tr key={`${rota.file}-${rota.method}-${rota.path}-${rota.handler}`}>
              <td>{rota.method.toUpperCase()}</td>
              <td>{rota.path}</td>
              <td>{rota.handler}</td>
              <td>{rota.file}</td>
              <td>
                <button type="button" className="ly-danger" onClick={() => void remover(rota)}>Remover</button>
              </td>
            </tr>
          ))}
          {view && view.rotas.length === 0 && (
            <tr>
              <td colSpan={5}>Nenhuma rota encontrada.</td>
            </tr>
          )}
        </tbody>
      </table>
      <h3>Acrescentar</h3>
      <div className="ly-row">
        <label>
          Arquivo
          <select value={file} onChange={(e) => setFile(e.target.value)}>
            {Object.keys(view?.arquivos || {}).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Metodo
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {METODOS.map((m) => (
              <option key={m} value={m}>{m.toUpperCase()}</option>
            ))}
          </select>
        </label>
        <label>
          Caminho
          <input value={caminho} onChange={(e) => setCaminho(e.target.value)} />
        </label>
        <label>
          Handler
          <input value={handler} onChange={(e) => setHandler(e.target.value)} placeholder="PedidoController.getPedido" />
        </label>
        <label>
          Controller
          <select value={controllerPath} onChange={(e) => setControllerPath(e.target.value)}>
            <option value="">(nao criar handler)</option>
            {(view?.controllers || []).map((c) => (
              <option key={c.file} value={c.file}>{c.file}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="ly-actions">
        <button type="button" onClick={() => void adicionar()}>Salvar rota</button>
      </div>
      {msg && <p className="ly-msg ok">{msg}</p>}
    </div>
  );
}
