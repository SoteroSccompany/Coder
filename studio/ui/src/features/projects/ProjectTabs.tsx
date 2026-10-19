// Barra de abas e tela inicial (novo, abrir, recentes). O editor do manifesto abre por cima do layout.

import { createPortal } from 'react-dom';
import { studioActions, useStudio } from '../../state/store';
import { HomeScreen } from './HomeScreen';
import { ManifestEditor } from './ManifestEditor';
import { projectUi, useProjectUi } from './uiState';
import './projects.css';

export function ProjectTabs() {
  const projects = useStudio((s) => s.projects);
  const active = useStudio((s) => s.activeProjectId);
  const connection = useStudio((s) => s.connection);
  const ui = useProjectUi();

  return (
    <div className="topbar">
      <div className="brand">Coder Studio</div>
      <div className="project-tabs">
        {projects.map((p) => (
          <div
            key={p.id}
            className={`project-tab ${p.id === active ? 'active' : ''}`}
            onClick={() => {
              studioActions.setActiveProject(p.id);
              projectUi.hideHome();
            }}
            title={p.rootPath}
          >
            {p.name}
          </div>
        ))}
        {projects.length === 0 && <span className="muted">Nenhum projeto aberto</span>}
      </div>
      <div className="proj-actions">
        <button className="proj-btn ghost" onClick={() => projectUi.showHome('home')}>
          Inicio
        </button>
        <button className="proj-btn" onClick={() => projectUi.showHome('new')}>
          Novo
        </button>
        <button className="proj-btn" onClick={() => projectUi.showHome('open')}>
          Abrir
        </button>
        <button className="proj-btn ghost" disabled={!active} onClick={() => projectUi.setCustomize(true)}>
          Personalizar
        </button>
      </div>
      <div className={`conn conn-${connection}`} title="Conexao WebSocket com o server">
        {connection === 'open' ? 'online' : connection === 'connecting' ? 'conectando...' : 'offline'}
      </div>
      {ui.home && createPortal(<div className="proj-overlay"><HomeScreen initialMode={ui.mode} /></div>, document.body)}
      {ui.customize &&
        createPortal(
          <div className="proj-overlay">
            <ManifestEditor projectId={active} onClose={() => projectUi.setCustomize(false)} />
          </div>,
          document.body,
        )}
    </div>
  );
}
