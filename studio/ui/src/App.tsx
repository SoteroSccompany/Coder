// Layout: abas de projeto (topo) | explorador por camada (esquerda) | editor (centro) | painel inferior.
// Este arquivo so compoe features; cada fase evolui a SUA pasta em `src/features/<nome>/` e se
// registra via `register.ts` (ver studio/README.md), sem precisar editar o App.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, ApiError, setToken, studioSocket } from './api/client';
import type { FileEventPayload } from './api/types';
import { studioActions, useStudio } from './state/store';
import { ProjectTabs } from './features/projects/ProjectTabs';
import { Explorer } from './features/explorer/Explorer';
import { EditorArea } from './features/editor/EditorArea';
import { bottomPanels } from './features/panels/registry';

function TokenGate({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="token-gate">
      <h2>Coder Studio</h2>
      <p>O servidor exige um token (STUDIO_TOKEN).</p>
      <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Token" />
      <button
        onClick={() => {
          setToken(value);
          onSaved();
        }}
      >
        Entrar
      </button>
    </div>
  );
}

function BottomPanels() {
  const panels = useSyncExternalStore(bottomPanels.subscribe, bottomPanels.getSnapshot);
  const projectId = useStudio((s) => s.activeProjectId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const current = panels.find((p) => p.id === activeId) ?? panels[0];

  return (
    <div className={`bottom ${collapsed ? 'collapsed' : ''}`}>
      <div className="bottom-tabs">
        {panels.map((p) => (
          <div key={p.id} className={`bottom-tab ${p.id === current?.id ? 'active' : ''}`} onClick={() => setActiveId(p.id)}>
            {p.title}
          </div>
        ))}
        <button className="bottom-toggle" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▴' : '▾'}
        </button>
      </div>
      {!collapsed && current && (
        <div className="bottom-body">
          <current.component projectId={projectId} />
        </div>
      )}
    </div>
  );
}

export function App() {
  const [needsToken, setNeedsToken] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const projects = useStudio((s) => s.projects);

  // carga inicial + conexao WebSocket
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listProjects();
        if (cancelled) return;
        setNeedsToken(false);
        studioActions.setProjects(list);
        studioSocket.connect();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setNeedsToken(true);
        else studioActions.log('error', `Falha ao listar projetos: ${e instanceof Error ? e.message : e}`, { source: 'app' });
      }
    })();
    const off = studioSocket.onState(studioActions.setConnection);
    return () => {
      cancelled = true;
      off();
      studioSocket.disconnect();
    };
  }, [attempt]);

  // assina o canal de cada projeto aberto
  useEffect(() => {
    projects.forEach((p) => studioSocket.subscribe(p.id));
  }, [projects]);

  // eventos do watcher -> painel de logs
  useEffect(() => {
    const labels: Record<string, string> = {
      'file:changed': 'alterado',
      'file:added': 'criado',
      'file:removed': 'removido',
    };
    const offs = Object.keys(labels).map((type) =>
      studioSocket.on(type, (msg) => {
        const p = msg.payload as unknown as FileEventPayload;
        studioActions.log('info', `Arquivo ${labels[type]}: ${p.path}`, { projectId: msg.projectId, source: 'watcher' });
      }),
    );
    offs.push(
      studioSocket.on('log:line', (msg) => {
        const p = msg.payload as { level?: 'info' | 'warn' | 'error'; message?: string; source?: string };
        studioActions.log(p.level ?? 'info', p.message ?? '', { projectId: msg.projectId, source: p.source });
      }),
      studioSocket.on('watcher:error', (msg) =>
        studioActions.log('error', String((msg.payload as { message?: string }).message), { projectId: msg.projectId, source: 'watcher' }),
      ),
    );
    return () => offs.forEach((o) => o());
  }, []);

  if (needsToken) return <TokenGate onSaved={() => setAttempt((n) => n + 1)} />;

  return (
    <div className="app">
      <ProjectTabs />
      <div className="main">
        <aside className="sidebar">
          <Explorer />
        </aside>
        <section className="center">
          <EditorArea />
        </section>
      </div>
      <BottomPanels />
    </div>
  );
}
