// Area central: abas de arquivos abertos + editor da camada (registro) ou Monaco (padrao).

import { Suspense, useState } from 'react';
import { selectProjectUi, studioActions, useStudio } from '../../state/store';
import { DefaultEditor, getCustomEditor } from '../editors/registry';

export function EditorArea() {
  const projectId = useStudio((s) => s.activeProjectId);
  const projects = useStudio((s) => s.projects);
  const ui = useStudio(selectProjectUi);
  const [asText, setAsText] = useState<Record<string, boolean>>({});

  if (!projectId) return <div className="editor-msg">Nenhum projeto aberto.</div>;
  const project = projects.find((p) => p.id === projectId);
  const layerOf = (path: string) => {
    let best: { id: string; len: number } | null = null;
    for (const l of project?.layers ?? []) {
      if (l.basePath && (path === l.basePath || path.startsWith(`${l.basePath}/`)) && (!best || l.basePath.length > best.len)) {
        best = { id: l.id, len: l.basePath.length };
      }
    }
    return best?.id ?? null;
  };

  const active = ui.activeFile;
  const layer = active ? layerOf(active) : null;
  const Custom = getCustomEditor(layer);
  const key = active ? `${projectId}::${active}` : '';
  const showText = !Custom || asText[key];
  const Comp = showText ? DefaultEditor : Custom!;

  return (
    <div className="editor-area">
      <div className="file-tabs">
        {ui.openFiles.map((p) => (
          <div key={p} className={`file-tab ${p === active ? 'active' : ''}`} onClick={() => studioActions.activateFile(projectId, p)} title={p}>
            <span>{p.split('/').pop()}</span>
            <button
              className="tab-close"
              aria-label={`Fechar ${p}`}
              onClick={(e) => {
                e.stopPropagation();
                studioActions.closeFile(projectId, p);
              }}
            >
              x
            </button>
          </div>
        ))}
        {active && Custom && (
          <button className="toggle-view" onClick={() => setAsText((s) => ({ ...s, [key]: !s[key] }))}>
            {showText ? 'Ver editor da camada' : 'Ver como texto'}
          </button>
        )}
      </div>
      <div className="editor-body">
        {active ? (
          <Suspense fallback={<div className="editor-msg">Carregando editor...</div>}>
            <Comp key={key} projectId={projectId} path={active} layer={layer} />
          </Suspense>
        ) : (
          <div className="editor-msg">Selecione um arquivo no explorador.</div>
        )}
      </div>
    </div>
  );
}
