import { projectUi } from './uiState';

export function CustomizePanel({ projectId }: { projectId: string | null }) {
  if (!projectId) return <div className="explorer-msg">Abra um projeto para personalizar camadas, nomes e variaveis.</div>;
  return (
    <div className="logs-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span>Camadas, nomes, templates de arquivo, servicos, ignore e env-example.</span>
      <button className="proj-btn" onClick={() => projectUi.setCustomize(true)}>
        Abrir editor
      </button>
    </div>
  );
}
