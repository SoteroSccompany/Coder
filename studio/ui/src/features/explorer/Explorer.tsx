// Explorador por camada: le /api/projects/:id/tree e atualiza quando o watcher avisa.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, studioSocket } from '../../api/client';
import type { ProjectTree, TreeNode } from '../../api/types';
import { selectProjectUi, studioActions, useStudio } from '../../state/store';

function Node({ node, depth, projectId, activeFile }: { node: TreeNode; depth: number; projectId: string; activeFile: string | null }) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: 8 + depth * 12 };
  if (node.type === 'dir') {
    return (
      <div>
        <div className="tree-row dir" style={pad} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {node.name}
        </div>
        {open && node.children?.map((c) => <Node key={c.path} node={c} depth={depth + 1} projectId={projectId} activeFile={activeFile} />)}
      </div>
    );
  }
  return (
    <div
      className={`tree-row file ${activeFile === node.path ? 'active' : ''}`}
      style={pad}
      onClick={() => studioActions.openFile(projectId, node.path)}
      title={node.path}
    >
      {node.name}
    </div>
  );
}

function Section({ title, hint, nodes, projectId, activeFile, dim }: { title: string; hint?: string; nodes: TreeNode[]; projectId: string; activeFile: string | null; dim?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`tree-section ${dim ? 'dim' : ''}`}>
      <div className="tree-section-title" onClick={() => setOpen(!open)} title={hint}>
        {open ? '▾' : '▸'} {title}
      </div>
      {open && nodes.map((n) => <Node key={n.path} node={n} depth={0} projectId={projectId} activeFile={activeFile} />)}
    </div>
  );
}

export function Explorer() {
  const projectId = useStudio((s) => s.activeProjectId);
  const ui = useStudio(selectProjectUi);
  const [tree, setTree] = useState<ProjectTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setTree(await api.getTree(projectId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    setTree(null);
    void load();
  }, [load]);

  // atualiza (com debounce) quando arquivos/pastas sao criados ou removidos
  useEffect(() => {
    if (!projectId) return;
    const refresh = (msg: { projectId: string | null }) => {
      if (msg.projectId !== projectId) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void load(), 300);
    };
    const offs = ['file:added', 'file:removed', 'tree:changed'].map((t) => studioSocket.on(t, refresh));
    return () => offs.forEach((o) => o());
  }, [projectId, load]);

  if (!projectId) return <div className="explorer-msg">Sem projeto.</div>;
  if (error) return <div className="explorer-msg error">Erro: {error}</div>;
  if (!tree) return <div className="explorer-msg">Carregando...</div>;

  return (
    <div className="explorer">
      {tree.layers.map((l) => (
        <Section key={l.id} title={l.id} hint={l.path} nodes={l.children} projectId={projectId} activeFile={ui.activeFile} dim={!l.exists} />
      ))}
      <Section title="outros" nodes={tree.other} projectId={projectId} activeFile={ui.activeFile} />
    </div>
  );
}
