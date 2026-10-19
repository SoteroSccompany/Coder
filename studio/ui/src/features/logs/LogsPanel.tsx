import { useEffect, useRef } from 'react';
import { studioActions, useStudio } from '../../state/store';

export function LogsPanel({ projectId }: { projectId: string | null }) {
  const logs = useStudio((s) => s.logs);
  const end = useRef<HTMLDivElement>(null);
  const visible = logs.filter((l) => !l.projectId || !projectId || l.projectId === projectId);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [visible.length]);

  return (
    <div className="logs">
      <div className="logs-toolbar">
        <button onClick={() => studioActions.clearLogs()}>Limpar</button>
      </div>
      <div className="logs-lines">
        {visible.map((l) => (
          <div key={l.id} className={`log log-${l.level}`}>
            <span className="log-ts">{new Date(l.ts).toLocaleTimeString()}</span>
            {l.source && <span className="log-src">[{l.source}]</span>} {l.message}
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
