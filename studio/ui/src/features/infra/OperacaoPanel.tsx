import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { studioActions } from '../../state/store';
import { infraApi, type ItemCatalogo, type SaidaComando } from './api';
import './infra.css';

export function OperacaoPanel({ projectId }: { projectId: string | null }) {
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
  const [ativos, setAtivos] = useState<string[]>([]);
  const [saida, setSaida] = useState('Pronto.');
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function carregar(id: string) {
    try {
      const [cat, srv] = await Promise.all([infraApi.catalogo(id), infraApi.servicos(id)]);
      setCatalogo(cat.catalogo);
      setAtivos(srv.servicos);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!projectId) return;
    void carregar(projectId);
  }, [projectId]);

  function mostrar(titulo: string, corpo: string) {
    setSaida(`${titulo}\n${corpo}`.trim());
  }

  async function executar(titulo: string, fn: () => Promise<SaidaComando>) {
    if (!projectId) return;
    setBusy(true);
    setErro(null);
    try {
      const res = await fn();
      mostrar(titulo, `$ ${res.comando.join(' ')}\ncodigo ${res.code}\n${res.stdout}${res.stderr ? `\n${res.stderr}` : ''}`);
      studioActions.log(res.ok ? 'info' : 'warn', `${titulo}: codigo ${res.code}`, { projectId, source: 'infra' });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setErro(msg);
      mostrar(titulo, msg);
      studioActions.log('error', msg, { projectId, source: 'infra' });
    } finally {
      setBusy(false);
    }
  }

  async function adicionar(id: string) {
    if (!projectId) return;
    setBusy(true);
    setErro(null);
    try {
      const res = await infraApi.adicionar(projectId, id);
      mostrar(
        res.jaExistia ? `${id} ja estava no compose` : `${id} adicionado`,
        `gateway: ${res.gatewayCriado ? 'criado' : 'ja existia'}\nblocos: ${res.blocos.join(', ')}`,
      );
      await carregar(projectId);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saude() {
    if (!projectId) return;
    setBusy(true);
    setErro(null);
    try {
      const res = await infraApi.health(projectId);
      mostrar('Healthcheck', `${res.entry || ''} ${res.url || ''}\n${res.ok ? `HTTP ${res.status}` : res.error || 'falhou'}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setErro(msg);
      mostrar('Healthcheck', msg);
    } finally {
      setBusy(false);
    }
  }

  if (!projectId) return <div className="inf"><p className="inf-msg">Abra um projeto para operar a infra.</p></div>;

  return (
    <div className="inf">
      <div className="inf-bar">
        <button type="button" disabled={busy} onClick={() => void executar('Subir', () => infraApi.up(projectId))}>Subir</button>
        <button type="button" className="inf-ghost" disabled={busy} onClick={() => void executar('Parar', () => infraApi.down(projectId))}>Parar</button>
        <button type="button" className="inf-ghost" disabled={busy} onClick={() => void executar('Logs', () => infraApi.logs(projectId))}>Logs</button>
        <button type="button" className="inf-ghost" disabled={busy} onClick={() => void executar('Migrate', () => infraApi.migrate(projectId))}>Migrate</button>
        <button type="button" className="inf-ghost" disabled={busy} onClick={() => void executar('Jest', () => infraApi.testar(projectId))}>Jest</button>
        <button type="button" className="inf-ghost" disabled={busy} onClick={() => void saude()}>Saude</button>
        <span className="inf-msg">no compose: {ativos.length ? ativos.join(', ') : 'nenhum'}</span>
      </div>
      {erro && <p className="inf-msg erro">{erro}</p>}
      <div className="inf-catalogo">
        {catalogo.map((item) => (
          <div className="inf-card" key={item.id}>
            <strong>{item.titulo}</strong>
            <span>{item.descricao}</span>
            <button type="button" disabled={busy} onClick={() => void adicionar(item.id)}>
              {ativos.includes(item.id) ? 'Ja adicionado' : 'Adicionar'}
            </button>
          </div>
        ))}
      </div>
      <pre className="inf-out">{saida}</pre>
    </div>
  );
}
