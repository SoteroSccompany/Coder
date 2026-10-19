import { useEffect, useState } from 'react';
import { errorMessage, projectsApi, refreshProjects, type RenameResult } from './api';

const EDITORS = ['text', 'monaco', 'blocks', 'domain-form'];

interface LayerRow {
  id: string;
  path: string;
  editor: string;
  file: string;
}

export function ManifestEditor({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [entry, setEntry] = useState('index.js');
  const [port, setPort] = useState<number | ''>('');
  const [layers, setLayers] = useState<LayerRow[]>([]);
  const [naming, setNaming] = useState<[string, string][]>([]);
  const [fileTemplates, setFileTemplates] = useState<[string, string][]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [services, setServices] = useState<Record<string, { enabled?: boolean; port?: number; managementPort?: number; smtpPort?: number; uiPort?: number }>>({});
  const [ignore, setIgnore] = useState<string[]>([]);
  const [defaultIgnore, setDefaultIgnore] = useState<string[]>([]);
  const [extraIgnore, setExtraIgnore] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [envText, setEnvText] = useState('');
  const [envHash, setEnvHash] = useState<string | null>(null);
  const [envMissing, setEnvMissing] = useState(false);
  const [preview, setPreview] = useState<Record<string, RenameResult>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancel = false;
    Promise.all([projectsApi.manifest(projectId), projectsApi.envExample(projectId)])
      .then(([man, env]) => {
        if (cancel) return;
        const m = man.manifest;
        setName(String(m.name || ''));
        setEntry(String(m.entry || 'index.js'));
        setPort(typeof m.port === 'number' ? m.port : '');
        const rawLayers = (m.layers || {}) as Record<string, { path?: string; editor?: string; file?: string }>;
        setLayers(
          Object.entries(rawLayers).map(([id, layer]) => ({
            id,
            path: layer.path || '',
            editor: layer.editor || 'text',
            file: layer.file || '',
          })),
        );
        setNaming(Object.entries((m.naming || {}) as Record<string, string>));
        setFileTemplates(Object.entries((m.fileTemplates || {}) as Record<string, string>));
        setServices((m.services || {}) as typeof services);
        setIgnore(man.effectiveIgnore || []);
        setDefaultIgnore(man.defaultIgnore || []);
        setBlocks(Array.isArray(m.blocks) ? (m.blocks as string[]) : []);
        setEnvText(env.content || '');
        setEnvHash(env.hash);
        setEnvMissing(!!env.missing);
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      cancel = true;
    };
  }, [projectId]);

  if (!projectId) {
    return (
      <div className="proj-wrap">
        <p>Abra um projeto para personalizar.</p>
        <button className="proj-btn ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
    );
  }

  function layerPatch() {
    const out: Record<string, { path: string; editor: string; file?: string }> = {};
    for (const layer of layers) {
      out[layer.id] = { path: layer.path, editor: layer.editor };
      if (layer.file) out[layer.id].file = layer.file;
    }
    return out;
  }

  async function saveManifest() {
    setBusy(true);
    setError(null);
    try {
      await projectsApi.saveManifest(projectId!, {
        name,
        entry,
        port: port === '' ? null : port,
        runtime: 'node',
        layers: layerPatch(),
        naming: Object.fromEntries(naming),
        fileTemplates: Object.fromEntries(fileTemplates),
        services,
        ignore,
        blocks,
      });
      await refreshProjects(projectId!);
      setInfo('Manifesto salvo.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveEnv() {
    setBusy(true);
    setError(null);
    try {
      const res = await projectsApi.saveEnvExample(projectId!, envText, envMissing ? null : envHash);
      setEnvHash(res.hash);
      setEnvMissing(false);
      setInfo('env-example.txt salvo. O .env real permanece oculto.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function previewMove(layer: LayerRow, nextPath: string) {
    setError(null);
    try {
      const res = await projectsApi.renamePreview(projectId!, layer.id, nextPath);
      setPreview((p) => ({ ...p, [layer.id]: res }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function applyMove(layer: LayerRow, nextPath: string) {
    setBusy(true);
    setError(null);
    try {
      await projectsApi.renameApply(projectId!, layer.id, nextPath);
      setPreview((p) => {
        const copy = { ...p };
        delete copy[layer.id];
        return copy;
      });
      const man = await projectsApi.manifest(projectId!);
      const rawLayers = (man.manifest.layers || {}) as Record<string, { path?: string; editor?: string; file?: string }>;
      setLayers(
        Object.entries(rawLayers).map(([id, item]) => ({
          id,
          path: item.path || '',
          editor: item.editor || 'text',
          file: item.file || '',
        })),
      );
      await refreshProjects(projectId!);
      setInfo(`Camada ${layer.id} movida.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="proj-wrap">
      <div className="proj-row">
        <h1 className="grow">Personalizar projeto</h1>
        <button className="proj-btn ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
      {error && <div className="proj-error">{error}</div>}
      {info && <div className="proj-note">{info}</div>}

      <section className="proj-form">
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Entry
          <input value={entry} onChange={(e) => setEntry(e.target.value)} />
        </label>
        <label>
          Porta
          <input type="number" value={port} onChange={(e) => setPort(e.target.value ? Number(e.target.value) : '')} />
        </label>
      </section>

      <section>
        <h2>Camadas</h2>
        <table className="layer-table">
          <thead>
            <tr>
              <th>Id</th>
              <th>Pasta</th>
              <th>Editor</th>
              <th>Arquivo</th>
            </tr>
          </thead>
          <tbody>
            {layers.map((layer, index) => (
              <LayerEditorRow
                key={layer.id}
                layer={layer}
                preview={preview[layer.id]}
                busy={busy}
                onChange={(patch) => setLayers(layers.map((l, i) => (i === index ? { ...l, ...patch } : l)))}
                onPreview={(next) => previewMove(layer, next)}
                onApply={(next) => applyMove(layer, next)}
              />
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Nomes</h2>
        {naming.map(([key, value], index) => (
          <div key={key} className="proj-row">
            <input value={key} readOnly />
            <input
              className="grow"
              value={value}
              onChange={(e) => setNaming(naming.map((pair, i) => (i === index ? [pair[0], e.target.value] : pair)))}
            />
          </div>
        ))}
      </section>

      <section className="proj-form">
        <h2>Templates de arquivo</h2>
        <label>
          Tipo
          <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
            <option value="">escolha</option>
            {fileTemplates.map(([key]) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        {templateKey && (
          <textarea
            value={fileTemplates.find((p) => p[0] === templateKey)?.[1] || ''}
            onChange={(e) =>
              setFileTemplates(fileTemplates.map((pair) => (pair[0] === templateKey ? [pair[0], e.target.value] : pair)))
            }
          />
        )}
        <div className="proj-row">
          <input
            placeholder="novo tipo"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const id = (e.target as HTMLInputElement).value.trim();
              if (!id || fileTemplates.some((p) => p[0] === id)) return;
              setFileTemplates([...fileTemplates, [id, '']]);
              setTemplateKey(id);
              (e.target as HTMLInputElement).value = '';
            }}
          />
          <span className="proj-note">Enter para acrescentar</span>
        </div>
      </section>

      <section>
        <h2>Servicos</h2>
        <div className="proj-list">
          {Object.entries(services).map(([id, svc]) => (
            <label key={id} className="proj-row">
              <input
                type="checkbox"
                checked={!!svc?.enabled}
                onChange={(e) => setServices({ ...services, [id]: { ...svc, enabled: e.target.checked } })}
              />
              <span className="grow">{id}</span>
              <span className="proj-note">
                {svc?.port ? `porta ${svc.port}` : ''}
                {svc?.managementPort ? ` / management ${svc.managementPort}` : ''}
                {svc?.smtpPort ? ` smtp ${svc.smtpPort}` : ''}
                {svc?.uiPort ? ` ui ${svc.uiPort}` : ''}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2>Ignore</h2>
        <p className="proj-note">.env, security, Logs, node_modules e .git permanecem ignorados.</p>
        <div className="proj-checks">
          {ignore.map((item) => (
            <label key={item}>
              <input type="checkbox" checked disabled={defaultIgnore.includes(item)} readOnly />
              {item}
              {!defaultIgnore.includes(item) && (
                <button type="button" className="proj-btn ghost" onClick={() => setIgnore(ignore.filter((x) => x !== item))}>
                  tirar
                </button>
              )}
            </label>
          ))}
        </div>
        <div className="proj-row">
          <input value={extraIgnore} onChange={(e) => setExtraIgnore(e.target.value)} placeholder="pasta ou *.pem" />
          <button
            className="proj-btn"
            type="button"
            onClick={() => {
              const value = extraIgnore.trim();
              if (!value || ignore.includes(value)) return;
              setIgnore([...ignore, value]);
              setExtraIgnore('');
            }}
          >
            Acrescentar
          </button>
        </div>
      </section>

      <section className="proj-form">
        <h2>Variaveis (env-example.txt)</h2>
        <p className="proj-note">Edite o env-example.txt. O .env real permanece oculto.</p>
        <textarea value={envText} onChange={(e) => setEnvText(e.target.value)} />
        <button className="proj-btn" type="button" onClick={saveEnv} disabled={busy}>
          Salvar env-example
        </button>
      </section>

      <section>
        <h2>Blocos do projeto</h2>
        <p className="proj-note">Bibliotecas: {blocks.join(', ') || 'core, .studio/blocks'}. A pasta .studio/blocks guarda blocos deste projeto. O motor de blocos fica para outra fase.</p>
        <button
          className="proj-btn ghost"
          type="button"
          onClick={() =>
            projectsApi
              .ensureBlocks(projectId)
              .then(() => setInfo('Pasta .studio/blocks pronta.'))
              .catch((e) => setError(errorMessage(e)))
          }
        >
          Garantir .studio/blocks
        </button>
      </section>

      <button className="proj-btn" type="button" onClick={saveManifest} disabled={busy}>
        {busy ? 'Salvando...' : 'Salvar manifesto'}
      </button>
    </div>
  );
}

function LayerEditorRow({
  layer,
  preview,
  busy,
  onChange,
  onPreview,
  onApply,
}: {
  layer: LayerRow;
  preview?: RenameResult;
  busy: boolean;
  onChange: (patch: Partial<LayerRow>) => void;
  onPreview: (path: string) => void;
  onApply: (path: string) => void;
}) {
  const [nextPath, setNextPath] = useState(layer.path);
  useEffect(() => setNextPath(layer.path), [layer.path]);
  const ready = preview && preview.to === nextPath && preview.errors.length === 0;
  return (
    <>
      <tr>
        <td>{layer.id}</td>
        <td>
          <input value={nextPath} onChange={(e) => setNextPath(e.target.value)} />
          <div className="proj-actions" style={{ marginTop: 4 }}>
            <button className="proj-btn ghost" type="button" disabled={nextPath === layer.path} onClick={() => onPreview(nextPath)}>
              Previa
            </button>
            <button className="proj-btn" type="button" disabled={!ready || busy} onClick={() => onApply(nextPath)}>
              Aplicar
            </button>
          </div>
        </td>
        <td>
          <select value={layer.editor} onChange={(e) => onChange({ editor: e.target.value })}>
            {EDITORS.map((ed) => (
              <option key={ed} value={ed}>
                {ed}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input value={layer.file} onChange={(e) => onChange({ file: e.target.value })} placeholder="{Entity}.js" />
        </td>
      </tr>
      {preview && preview.to === nextPath && (
        <tr>
          <td colSpan={4}>
            {preview.errors.length > 0 && <div className="proj-error">{preview.errors.map((e) => `${e.path}: ${e.message}`).join('\n')}</div>}
            {preview.directoryMove && (
              <div className="proj-note">
                Pasta {preview.directoryMove.from} → {preview.directoryMove.to}
              </div>
            )}
            {!preview.directoryMove && <div className="proj-note">A pasta ainda nao existe; o manifesto e que muda.</div>}
            {preview.changes.length === 0 && <div className="proj-note">Nenhum require precisa mudar.</div>}
            {preview.changes.map((ch) => (
              <pre key={ch.path} className="diff">
                {ch.diff}
              </pre>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}
