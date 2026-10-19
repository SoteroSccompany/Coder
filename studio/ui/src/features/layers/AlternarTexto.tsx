import { useState, type ReactNode } from 'react';
import { MonacoFileEditor } from '../editor/MonacoFileEditor';
import type { EditorProps } from '../editors/types';

export function AlternarTexto({
  projectId,
  path,
  layer,
  children,
}: EditorProps & { children: ReactNode }) {
  const [texto, setTexto] = useState(false);
  return (
    <div className="ly">
      <div className="ly-bar">
        <button type="button" className="ly-ghost" onClick={() => setTexto((v) => !v)}>
          {texto ? 'Voltar ao editor da camada' : 'Ver como texto'}
        </button>
      </div>
      {texto ? <MonacoFileEditor projectId={projectId} path={path} layer={layer} /> : children}
    </div>
  );
}
