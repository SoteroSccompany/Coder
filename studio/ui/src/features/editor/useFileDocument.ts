// Hook de documento: carrega um arquivo, controla edicao/salvamento com checagem de hash (409),
// e reage a mudancas externas avisadas pelo watcher (WebSocket `file:changed`/`file:removed`).
// Reutilizavel por QUALQUER editor de camada (Monaco, blocos, formularios...).

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, ConflictError, studioSocket } from '../../api/client';
import type { FileEventPayload } from '../../api/types';
import { studioActions } from '../../state/store';

export interface ConflictInfo {
  currentHash: string | null;
  currentContent?: string;
}

export interface ExternalChange {
  removed: boolean;
  hash?: string;
}

export interface FileDocument {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** Texto atual no editor. */
  value: string;
  /** Ultimo texto conhecido no disco (base do diff "sujo"). */
  savedValue: string;
  dirty: boolean;
  saving: boolean;
  conflict: ConflictInfo | null;
  externalChange: ExternalChange | null;
  setValue: (v: string) => void;
  /** Salva (Ctrl/Cmd+S). Em 409 preenche `conflict`. */
  save: () => Promise<void>;
  /** Descarta alteracoes locais e recarrega do disco. */
  reload: () => Promise<void>;
  /** Resolve o conflito sobrescrevendo o disco com a versao local. */
  overwrite: () => Promise<void>;
  /** Ignora o aviso de mudanca externa (mantem a versao local). */
  dismissExternal: () => void;
}

export function useFileDocument(projectId: string, path: string): FileDocument {
  const [status, setStatus] = useState<FileDocument['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [value, setValueState] = useState('');
  const [savedValue, setSavedValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [externalChange, setExternalChange] = useState<ExternalChange | null>(null);

  // refs espelham o estado para uso dentro de callbacks/handlers do WebSocket
  const baseHash = useRef<string | null>(null);
  const valueRef = useRef('');
  const savedRef = useRef('');
  const exists = useRef(true);

  const applyLoaded = useCallback((content: string, hash: string | null) => {
    baseHash.current = hash;
    valueRef.current = content;
    savedRef.current = content;
    setValueState(content);
    setSavedValue(content);
    setConflict(null);
    setExternalChange(null);
  }, []);

  const reload = useCallback(async () => {
    try {
      const f = await api.readFile(projectId, path);
      exists.current = true;
      applyLoaded(f.content, f.hash);
      setStatus('ready');
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // arquivo novo/inexistente: editor vazio, salvar cria (baseHash null)
        exists.current = false;
        applyLoaded('', null);
        setStatus('ready');
        return;
      }
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, path, applyLoaded]);

  useEffect(() => {
    setStatus('loading');
    void reload();
  }, [reload]);

  // Mudancas externas (watcher)
  useEffect(() => {
    const onEvent = (removed: boolean) => (msg: { projectId: string | null; payload: Record<string, unknown> }) => {
      const p = msg.payload as unknown as FileEventPayload;
      if (msg.projectId !== projectId || p.path !== path) return;
      if (!removed && p.hash && p.hash === baseHash.current) return; // eco da nossa propria gravacao
      const dirty = valueRef.current !== savedRef.current;
      if (!removed && !dirty) {
        studioActions.log('info', `Recarregado apos alteracao externa: ${path}`, { projectId, source: 'editor' });
        void reload();
        return;
      }
      setExternalChange({ removed, hash: p.hash });
    };
    const offChanged = studioSocket.on('file:changed', onEvent(false));
    const offRemoved = studioSocket.on('file:removed', onEvent(true));
    return () => {
      offChanged();
      offRemoved();
    };
  }, [projectId, path, reload]);

  const setValue = useCallback((v: string) => {
    valueRef.current = v;
    setValueState(v);
  }, []);

  const doSave = useCallback(
    async (hashToUse: string | null) => {
      setSaving(true);
      try {
        const content = valueRef.current;
        const res = await api.writeFile(projectId, path, content, hashToUse);
        baseHash.current = res.hash;
        savedRef.current = content;
        exists.current = true;
        setSavedValue(content);
        setConflict(null);
        setExternalChange(null);
        studioActions.log('info', `Salvo: ${path}`, { projectId, source: 'editor' });
      } catch (e) {
        if (e instanceof ConflictError) {
          setConflict({ currentHash: e.currentHash, currentContent: e.currentContent });
          studioActions.log('warn', `Conflito ao salvar ${path}: o arquivo mudou no disco`, { projectId, source: 'editor' });
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          studioActions.log('error', `Falha ao salvar ${path}: ${msg}`, { projectId, source: 'editor' });
        }
      } finally {
        setSaving(false);
      }
    },
    [projectId, path],
  );

  const save = useCallback(() => doSave(exists.current ? baseHash.current : null), [doSave]);

  const overwrite = useCallback(async () => {
    if (!conflict) return;
    await doSave(conflict.currentHash);
  }, [conflict, doSave]);

  return {
    status,
    error,
    value,
    savedValue,
    dirty: value !== savedValue,
    saving,
    conflict,
    externalChange,
    setValue,
    save,
    reload,
    overwrite,
    dismissExternal: () => setExternalChange(null),
  };
}
