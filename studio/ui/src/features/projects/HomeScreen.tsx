import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { studioActions, useStudio } from '../../state/store';
import { errorMessage, projectsApi, type ImportDetection, type RecenteItem, type TemplateInfo } from './api';
import { refreshProjects } from './api';
import { projectUi, type HomeMode } from './uiState';

const SERVICE_LABELS: Record<string, string> = {
  mysql: 'MySQL',
  redis: 'Redis',
  rabbitmq: 'RabbitMQ',
  mailpit: 'Mailpit',
};

export function HomeScreen({ initialMode }: { initialMode: HomeMode }) {
  const projects = useStudio((s) => s.projects);
  const [mode, setMode] = useState<HomeMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [recentes, setRecentes] = useState<RecenteItem[]>([]);
  const [archived, setArchived] = useState<RecenteItem[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<{ name: string; rootPath: string; slug: string }[]>([]);

  async function loadLists() {
    const [rec, ws] = await Promise.all([projectsApi.recentes(), projectsApi.workspace()]);
    setRecentes(rec.recentes);
    setArchived(rec.archived);
    setWorkspaceProjects(ws.projects);
  }

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    loadLists().catch((e) => setError(errorMessage(e)));
  }, []);

  async function afterOpen(id: string, arquivo?: string) {
    await refreshProjects(id);
    if (arquivo) studioActions.openFile(id, arquivo);
    projectUi.hideHome();
  }

  return (
    <div className="proj-wrap">
      <h1>Coder Studio</h1>
      <div className="tabs-inline">
        <button className={`tab-chip ${mode === 'home' ? 'active' : ''}`} onClick={() => setMode('home')}>
          Inicio
        </button>
        <button className={`tab-chip ${mode === 'new' ? 'active' : ''}`} onClick={() => setMode('new')}>
          Novo projeto
        </button>
        <button className={`tab-chip ${mode === 'open' ? 'active' : ''}`} onClick={() => setMode('open')}>
          Abrir pasta
        </button>
      </div>
      {error && <div className="proj-error">{error}</div>}

      <section className="proj-section">
        <h2>Abertos</h2>
        {projects.length === 0 && <div className="proj-note">Nenhum projeto aberto.</div>}
        <div className="tabs-inline">
          {projects.map((p) => (
            <button key={p.id} className="tab-chip" onClick={() => afterOpen(p.id)} title={p.rootPath}>
              {p.name}
            </button>
          ))}
        </div>
      </section>

      {mode === 'new' && <NewProject onCreated={afterOpen} onError={setError} />}
      {mode === 'open' && <OpenProject onOpened={afterOpen} onError={setError} />}

      <section className="proj-section">
        <h2>Recentes</h2>
        <ItemList
          items={recentes}
          empty="Nenhum projeto recente."
          onOpen={(item) =>
            projectsApi
              .open(item.rootPath)
              .then(async (res) => {
                if (res.needsImport || !res.project) {
                  setMode('open');
                  setError('Essa pasta ainda nao tem manifesto. Confirme o import em Abrir pasta.');
                  return;
                }
                await afterOpen(res.project.id);
              })
              .catch((e) => setError(errorMessage(e)))
          }
          extra={(item) => (
            <button
              className="proj-btn ghost"
              onClick={() =>
                projectsApi
                  .archivePath(item.rootPath)
                  .then(loadLists)
                  .then(() => refreshProjects())
                  .catch((e) => setError(errorMessage(e)))
              }
            >
              Arquivar
            </button>
          )}
        />
      </section>

      {workspaceProjects.length > 0 && (
        <section className="proj-section">
          <h2>Na pasta projects</h2>
          <ItemList
            items={workspaceProjects.map((p) => ({ ...p, openedAt: '' }))}
            empty=""
            onOpen={(item) =>
              projectsApi
                .open(item.rootPath)
                .then(async (res) => {
                  if (res.project) await afterOpen(res.project.id);
                })
                .catch((e) => setError(errorMessage(e)))
            }
          />
        </section>
      )}

      {archived.length > 0 && (
        <section className="proj-section">
          <h2>Arquivados</h2>
          <ItemList
            items={archived}
            empty=""
            onOpen={() => undefined}
            extra={(item) => (
              <button
                className="proj-btn"
                onClick={() =>
                  projectsApi
                    .unarchive(item.rootPath)
                    .then((res) => afterOpen(res.project.id))
                    .catch((e) => setError(errorMessage(e)))
                }
              >
                Restaurar
              </button>
            )}
          />
        </section>
      )}
    </div>
  );
}

function ItemList({
  items,
  empty,
  onOpen,
  extra,
}: {
  items: RecenteItem[];
  empty: string;
  onOpen: (item: RecenteItem) => void;
  extra?: (item: RecenteItem) => ReactNode;
}) {
  if (!items.length) return empty ? <div className="proj-note">{empty}</div> : null;
  return (
    <div className="proj-list">
      {items.map((item) => (
        <div key={item.rootPath} className="proj-row">
          <button className="proj-btn ghost grow" onClick={() => onOpen(item)} style={{ textAlign: 'left' }}>
            <div>{item.name}</div>
            <div className="path">{item.rootPath}</div>
          </button>
          {item.openedAt && <span className="proj-note">{new Date(item.openedAt).toLocaleString('pt-BR')}</span>}
          {extra?.(item)}
        </div>
      ))}
    </div>
  );
}

const USECASE_EXEMPLO = '@core/usecase/Exemplo/indexExemploUseCase.js';

function NewProject({ onCreated, onError }: { onCreated: (id: string, arquivo?: string) => Promise<void>; onError: (m: string) => void }) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState('api-minima');
  const [name, setName] = useState('');
  const [port, setPort] = useState<number | ''>('');
  const [servicePorts, setServicePorts] = useState<Record<string, number | null>>({});
  const [database, setDatabase] = useState('');
  const [services, setServices] = useState({ mysql: false, redis: false, rabbitmq: false, mailpit: false });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([projectsApi.templates(), projectsApi.ports()])
      .then(([list, ports]) => {
        setTemplates(list);
        if (ports.port) setPort(ports.port);
        setServicePorts({
          mysql: ports.services.mysql.port,
          redis: ports.services.redis.port,
          rabbitmq: ports.services.rabbitmq.port,
          rabbitmqManagement: ports.services.rabbitmq.managementPort,
          mailpitSmtp: ports.services.mailpit.smtpPort,
          mailpitUi: ports.services.mailpit.uiPort,
        });
        const first = list.find((t) => t.id === 'api-minima') || list[0];
        if (first) {
          setTemplate(first.id);
          applySuggested(first);
        }
      })
      .catch((e) => onError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applySuggested(t: TemplateInfo) {
    const next = { mysql: false, redis: false, rabbitmq: false, mailpit: false };
    for (const id of t.suggestedServices) {
      if (id in next) next[id as keyof typeof next] = true;
    }
    setServices(next);
  }

  function chooseTemplate(id: string) {
    setTemplate(id);
    const t = templates.find((x) => x.id === id);
    if (t && !touched) applySuggested(t);
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      const selected = templates.find((t) => t.id === template);
      const res = await projectsApi.create({
        name,
        template,
        templateSource: selected?.source,
        port: port === '' ? undefined : port,
        database: database || undefined,
        services,
        servicePorts,
      });
      const arquivo = template === 'api-minima' ? USECASE_EXEMPLO : undefined;
      await onCreated(res.project.id, arquivo);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="proj-form" onSubmit={submit}>
      <h2>Novo projeto</h2>
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Minha API" />
      </label>
      <div className="proj-grid">
        {templates.map((t) => (
          <button type="button" key={`${t.source}:${t.id}`} className={`proj-card ${t.id === template ? 'active' : ''}`} onClick={() => chooseTemplate(t.id)}>
            <strong>{t.label}</strong>
            <p>{t.description}</p>
          </button>
        ))}
      </div>
      <div className="proj-checks">
        {Object.keys(SERVICE_LABELS).map((id) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={services[id as keyof typeof services]}
              onChange={(e) => {
                setTouched(true);
                setServices({ ...services, [id]: e.target.checked });
              }}
            />
            {SERVICE_LABELS[id]}
          </label>
        ))}
      </div>
      {services.mysql && (
        <label>
          Banco
          <input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="nome_do_banco" />
        </label>
      )}
      <label>
        Porta
        <input type="number" value={port} min={1} max={65535} onChange={(e) => setPort(e.target.value ? Number(e.target.value) : '')} required />
      </label>
      <button className="proj-btn" disabled={busy || !name}>
        {busy ? 'Criando...' : 'Criar projeto'}
      </button>
    </form>
  );
}

function OpenProject({ onOpened, onError }: { onOpened: (id: string) => Promise<void>; onError: (m: string) => void }) {
  const [folder, setFolder] = useState('api');
  const [preview, setPreview] = useState<ImportDetection | null>(null);
  const [busy, setBusy] = useState(false);

  async function detect(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setPreview(null);
    try {
      const res = await projectsApi.open(folder);
      if (res.opened && res.project) {
        await onOpened(res.project.id);
        return;
      }
      if (res.detection) setPreview(res.detection);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setBusy(true);
    try {
      const res = await projectsApi.importProject(folder);
      await onOpened(res.project.id);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="proj-form" onSubmit={detect}>
      <h2>Abrir pasta</h2>
      <p className="proj-note">Caminho no servidor. Relativo ao workspace (ex.: api) ou absoluto.</p>
      <label>
        Pasta
        <input value={folder} onChange={(e) => setFolder(e.target.value)} required />
      </label>
      <button className="proj-btn" disabled={busy}>
        {busy ? 'Lendo...' : 'Abrir'}
      </button>
      {preview && !preview.hasManifest && (
        <div className="proj-section">
          <p>A pasta nao tem studio.project.json. O import abaixo so grava o manifesto quando voce confirmar.</p>
          <h2>Camadas reconhecidas</h2>
          <ul>
            {preview.layers.map((l) => (
              <li key={l.id}>
                {l.id}: {l.path} ({l.editor})
              </li>
            ))}
          </ul>
          <h2>Pastas sem logica (texto)</h2>
          <ul>
            {preview.unmapped.map((l) => (
              <li key={l.id}>
                {l.path} — editor {l.editor}
                {l.hiddenByIgnore ? ' (oculta pelo ignore)' : ''}
              </li>
            ))}
          </ul>
          <button type="button" className="proj-btn" onClick={confirmImport} disabled={busy}>
            Confirmar importacao
          </button>
        </div>
      )}
    </form>
  );
}
