// Dialogo: marca trechos do codigo selecionado como parametros e grava o .block.json.

import { useMemo, useState } from 'react';
import type { ParamMarcado } from './types';

interface Props {
  codigo: string;
  onFechar: () => void;
  onCriar: (body: {
    id: string;
    label: string;
    categoria: string;
    icone: string;
    params: ParamMarcado[];
    scope: 'project' | 'global';
  }) => Promise<void>;
}

function slug(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function CreateBlockDialog({ codigo, onFechar, onCriar }: Props) {
  const [label, setLabel] = useState('');
  const [categoria, setCategoria] = useState('dados');
  const [icone, setIcone] = useState('code');
  const [scope, setScope] = useState<'project' | 'global'>('project');
  const [nomeParam, setNomeParam] = useState('');
  const [tipoParam, setTipoParam] = useState<'expressao' | 'container'>('expressao');
  const [selecao, setSelecao] = useState<{ start: number; end: number } | null>(null);
  const [params, setParams] = useState<ParamMarcado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const id = useMemo(() => {
    const nome = slug(label) || 'novo-bloco';
    return `${categoria}.${nome}`;
  }, [categoria, label]);

  const preview = useMemo(() => {
    const marcas = [...params].sort((a, b) => b.start - a.start);
    let texto = codigo;
    for (const p of marcas) {
      const tok = p.tipo === 'container' ? `{{#${p.name}}}` : `{{${p.name}}}`;
      texto = texto.slice(0, p.start) + tok + texto.slice(p.end);
    }
    return texto;
  }, [codigo, params]);

  function marcar() {
    if (!selecao || selecao.end <= selecao.start) {
      setErro('Selecione um trecho no codigo (uma expressao ou um bloco { }).');
      return;
    }
    const nome = nomeParam.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome)) {
      setErro('Nome do parametro: letra ou _, depois letras e numeros.');
      return;
    }
    if (params.some((p) => p.name === nome)) {
      setErro('Ja existe um parametro com esse nome.');
      return;
    }
    if (params.some((p) => selecao.start < p.end && selecao.end > p.start)) {
      setErro('Esse trecho cruza um parametro ja marcado.');
      return;
    }
    setParams((lista) => [...lista, { name: nome, start: selecao.start, end: selecao.end, tipo: tipoParam }]);
    setNomeParam('');
    setErro(null);
  }

  async function criar() {
    if (!label.trim()) {
      setErro('Informe o nome do bloco.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await onCriar({ id, label: label.trim(), categoria, icone, params, scope });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setEnviando(false);
    }
  }

  return (
    <div className="blocks-dialog-fundo" role="presentation" onClick={onFechar}>
      <div className="blocks-dialog" role="dialog" aria-label="Transformar selecao em bloco" onClick={(e) => e.stopPropagation()}>
        <h3>Transformar selecao em bloco</h3>
        <p className="muted">Marque as partes que mudam. O resto vira o pattern que reconhece o trecho.</p>
        <textarea
          className="blocks-code"
          readOnly
          value={codigo}
          onSelect={(e) => {
            const el = e.currentTarget;
            setSelecao({ start: el.selectionStart, end: el.selectionEnd });
          }}
        />
        <div className="blocks-dialog-row">
          <input value={nomeParam} onChange={(e) => setNomeParam(e.target.value)} placeholder="nome do parametro" />
          <select value={tipoParam} onChange={(e) => setTipoParam(e.target.value as 'expressao' | 'container')}>
            <option value="expressao">expressao</option>
            <option value="container">container (filhos)</option>
          </select>
          <button type="button" onClick={marcar}>Marcar selecao</button>
        </div>
        {params.length > 0 && (
          <ul className="blocks-params">
            {params.map((p) => (
              <li key={p.name}>
                <code>{p.tipo === 'container' ? `{{#${p.name}}}` : `{{${p.name}}}`}</code>
                <span className="muted">{codigo.slice(p.start, p.end)}</span>
                <button type="button" className="blocks-ghost" onClick={() => setParams((lista) => lista.filter((x) => x.name !== p.name))}>
                  tirar
                </button>
              </li>
            ))}
          </ul>
        )}
        <label>
          Nome
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Chamar repositorio X" />
        </label>
        <div className="blocks-dialog-row">
          <label>
            Categoria
            <input value={categoria} onChange={(e) => setCategoria(e.target.value)} />
          </label>
          <label>
            Icone
            <input value={icone} onChange={(e) => setIcone(e.target.value)} />
          </label>
          <label>
            Onde gravar
            <select value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'global')}>
              <option value="project">projeto (.studio/blocks)</option>
              <option value="global">biblioteca global</option>
            </select>
          </label>
        </div>
        <p className="muted">
          id: <code>{id}</code>
        </p>
        <pre className="blocks-preview">{preview}</pre>
        {erro && <p className="blocks-erro">{erro}</p>}
        <div className="blocks-dialog-row">
          <button type="button" onClick={() => void criar()} disabled={enviando}>
            {enviando ? 'Gravando...' : 'Criar bloco'}
          </button>
          <button type="button" className="blocks-ghost" onClick={onFechar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
