// Editor padrao de arquivos: Monaco + salvar com Ctrl/Cmd+S + avisos de conflito (409)
// e de alteracao externa (watcher).

import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import './monacoSetup';
import { useFileDocument } from './useFileDocument';
import { languageOf } from './languages';
import type { EditorProps } from '../editors/types';

export function MonacoFileEditor({ projectId, path }: EditorProps) {
  const doc = useFileDocument(projectId, path);
  const saveRef = useRef(doc.save);
  saveRef.current = doc.save;

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current();
    });
  };

  // Ctrl/Cmd+S tambem fora do foco do Monaco (ex.: clicando nos botoes dos avisos)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (doc.status === 'loading') return <div className="editor-msg">Carregando {path}...</div>;
  if (doc.status === 'error') return <div className="editor-msg error">Erro: {doc.error}</div>;

  return (
    <div className="monaco-wrap">
      {doc.conflict && (
        <div className="banner banner-error" role="alert">
          <span>
            Conflito: <b>{path}</b> foi alterado no disco depois que voce abriu. Seu salvamento foi bloqueado.
          </span>
          <button onClick={() => void doc.reload()}>Recarregar do disco (descarta minhas alteracoes)</button>
          <button onClick={() => void doc.overwrite()}>Sobrescrever com minha versao</button>
        </div>
      )}
      {!doc.conflict && doc.externalChange && (
        <div className="banner banner-warn" role="alert">
          <span>
            {doc.externalChange.removed ? 'O arquivo foi removido do disco.' : 'O arquivo mudou no disco e voce tem alteracoes nao salvas.'}
          </span>
          {!doc.externalChange.removed && <button onClick={() => void doc.reload()}>Recarregar do disco</button>}
          <button onClick={doc.dismissExternal}>Manter minha versao</button>
        </div>
      )}
      <div className="monaco-host">
        <Editor
          path={`${projectId}::${path}`}
          language={languageOf(path)}
          value={doc.value}
          theme="vs-dark"
          onChange={(v) => doc.setValue(v ?? '')}
          onMount={onMount}
          options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 13, tabSize: 2 }}
        />
      </div>
      <div className="statusbar">
        {doc.saving ? 'Salvando...' : doc.dirty ? 'Alteracoes nao salvas (Ctrl/Cmd+S para salvar)' : 'Salvo'}
      </div>
    </div>
  );
}
