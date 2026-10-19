# Coder Studio

Plataforma web (Node + React) para criar, abrir e personalizar projetos de API. O **codigo `.js` e a fonte
da verdade**; a UI (explorador, Monaco e, nas proximas fases, blocos) e so uma visao dele.

Esta pasta contem a **Fase 1 — Fundacao**: servidor (arvore de arquivos, leitura/escrita segura, watcher,
WebSocket, AST com recast) e UI (explorador por camada + Monaco).

```
studio/
  server/      Node 20, CommonJS, Express + ws + chokidar + recast + jest
  ui/          React + Vite + TypeScript + Monaco (@monaco-editor/react)
  blocks/      biblioteca global de blocos (*.block.json) — vazia, ver blocks/README.md
  templates/   templates de projeto — vazia, ver templates/README.md
```

## Como rodar (local)

```bash
# terminal 1 — server (abre ../api como primeiro projeto se existir)
cd studio/server && npm install && npm start        # http://localhost:7900

# terminal 2 — UI (proxy /api e /ws -> server)
cd studio/ui && npm install && npm run dev          # http://localhost:5173

# testes / build
cd studio/server && npx jest
cd studio/ui && npm run build                       # tsc + vite build
```

Docker (dev, com volume): `studio/server/Dockerfile` e `studio/ui/Dockerfile`. No compose da raiz,
os servicos `studioserver` (porta 7900) e `studioui` (porta 7901) usam o profile `studio`:

```bash
docker compose --profile studio up studioserver studioui
```

Eles ficam na rede default (sem `networks`), com `STUDIO_WORKSPACE=/workspace` e o workspace
(`./`, incluindo `api/` e `projects/`) mais `./studio/blocks` montados em leitura e escrita.
A UI fala com o server em `http://studioserver:7900`.

### Variaveis de ambiente

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `STUDIO_SERVER_PORT` | `7900` | porta HTTP/WS do server |
| `STUDIO_HOST` | `0.0.0.0` | interface de escuta (precisa ser `0.0.0.0` dentro do container) |
| `STUDIO_TOKEN` | *(vazio)* | token opcional. Se definido, `/api/*` (exceto `/api/health`) e `/ws` exigem `Authorization: Bearer <token>`, `x-studio-token` ou `?token=` |
| `STUDIO_PROJECTS` | `../../api` (dev local, se existir) | caminhos de projetos abertos no boot, separados por virgula |
| `STUDIO_WATCH_POLLING` | `false` | `true` para usar polling no watcher (volumes Docker em macOS/Windows) |
| `STUDIO_MAX_FILE_BYTES` | `2097152` | tamanho maximo de arquivo lido/gravado |
| `STUDIO_SERVER_URL` | `http://localhost:7900` | (UI) alvo do proxy do Vite; no compose: `http://studioserver:7900` |
| `STUDIO_UI_PORT` | `5173` | (UI) porta do Vite |

### Seguranca (leia antes de publicar a porta)

O Studio **le e escreve arquivos do disco** (e, em fases futuras, controla Docker). Por isso:

- Escutar em `0.0.0.0` so e necessario **dentro do container**. Ao publicar portas no host, **restrinja a rede
  local**, ex.: `"127.0.0.1:7900:7900"` e `"127.0.0.1:5173:5173"`.
- Defina `STUDIO_TOKEN` sempre que a porta for alcancavel por outras maquinas. **Nunca exponha em producao/internet.**
- Protecoes ja implementadas: bloqueio de path traversal (`..`, caminho absoluto, byte nulo, symlink que
  escapa do projeto), `ignore` aplicado a leitura/escrita/arvore/watcher (`.env`, `security`, `Logs`,
  `node_modules`, `.git` — o manifesto pode **acrescentar**, nunca remover), escrita atomica e checagem de conflito por hash.
- O catalogo de infra grava `env-example.txt` e o `docker-compose.yaml` **do projeto**. Nao le nem escreve `.env`.
  Subir/parar/logs/migrate/jest exigem o mesmo `STUDIO_TOKEN` das outras rotas `/api`.

## compose studio enxuto

O `docker-compose.yaml` da raiz declara `legacysignaturenetwork` e `storagesignatureexperts` com
`external: true`. Essas redes **nao foram alteradas**. Se elas nao existirem na maquina, o Compose
recusa o arquivo inteiro — inclusive `docker compose --profile studio up` — porque a rede external
e validada mesmo para servicos que nao sobem.

Os servicos `studioserver` e `studioui` **nao listam `networks`**, entao entram na rede default
quando o arquivo consegue ser lido. Para subir so o Studio sem criar nem exigir a rede external,
use um arquivo separado (nao substitua o da raiz):

```yaml
# compose.studio.yaml — enxuto, rede propria (a default deste arquivo)
services:
  studioserver:
    build:
      context: ./studio/server
      dockerfile: Dockerfile
    ports:
      - "127.0.0.1:7900:7900"
    environment:
      STUDIO_WORKSPACE: /workspace
      STUDIO_SERVER_PORT: "7900"
      STUDIO_HOST: 0.0.0.0
      STUDIO_PROJECTS: /workspace/api
      STUDIO_WATCH_POLLING: "true"
    volumes:
      - ./:/workspace
      - ./studio/blocks:/workspace/studio/blocks
      - ./studio/server:/app
      - /app/node_modules

  studioui:
    build:
      context: ./studio/ui
      dockerfile: Dockerfile
    ports:
      - "127.0.0.1:7901:7901"
    environment:
      STUDIO_SERVER_URL: http://studioserver:7900
      STUDIO_UI_PORT: "7901"
      STUDIO_WATCH_POLLING: "true"
    volumes:
      - ./studio/ui:/app
      - /app/node_modules
    depends_on:
      - studioserver
```

```bash
docker compose -f compose.studio.yaml up
```

---

## Contratos para as proximas fases

> Objetivo: fases implementadas **em paralelo** nao editam os mesmos arquivos. Regra de ouro:
> **crie arquivos NOVOS** nos pontos de extensao abaixo; nao edite arquivos existentes da fundacao
> (excecoes explicitas listadas em cada item).

### 1. Server — layout fixo

```
studio/server/src/
  index.js                      boot (porta, projetos iniciais, shutdown)  — so editar se ESTRITAMENTE necessario
  app.js                        monta Express + servicos (createApp) — NAO editar
  context/projectContext.js     projeto ativo + registro de projetos abertos
  routes/                       *** extensao: 1 arquivo novo por fase/recurso ***
  services/                     *** extensao: servicos novos ***
  util/                         httpError.js, asyncHandler.js (use; nao edite)
  blocks/    projects/    layers/    infra/     <- pastas NOVAS reservadas por fase (ver tabela)
test/                           jest (um arquivo de teste por fase: test/<fase>.test.js)
```

| Fase | Arquivos que ela DEVE criar/possuir no server |
|------|-----------------------------------------------|
| `projects` | `src/projects/**`, `src/routes/projects.js` (**pode reescrever** o stub da fundacao; manter `GET /api/projects` -> `{ projects: [...] }`), `src/routes/projectsManager.js` etc., `templates/` |
| `customization` | `src/projects/manifest*.js` (novos), `src/routes/manifest.js`, `src/routes/layersConfig.js` |
| `blocks-engine` / `initial-blocks` / `block-creator` | `src/blocks/**`, `src/routes/blocks.js`, `blocks/<categoria>/*.block.json` |
| `layers` | `src/layers/**`, `src/routes/layers*.js` (nomes distintos de `layersConfig.js`) |
| `infra` | `src/infra/**`, `src/routes/infra.js`, `docker-compose.yaml` (raiz), `studio/server/Dockerfile` se necessario |
| `tests` | `test/**` novos |

#### 1.1 Rotas — `src/routes/<nome>.js`

`src/routes/index.js` carrega **automaticamente** todo `*.js` (e toda pasta com `index.js`) de `src/routes/`,
em ordem alfabetica, ignorando `index.js` e nomes iniciados em `_` ou `.`. Cada modulo exporta:

```js
module.exports = (app, deps) => { /* app.get/put/post... */ };
```

`deps` (mesma instancia para todas as rotas):

| Chave | O que e |
|-------|---------|
| `deps.config` | `{ version, token, watch }` |
| `deps.registry` | `ProjectRegistry`: `open(rootPath,{id})`, `close(id)`, `get(id)`, `require(id)` (404 se nao existe), `list()`; eventos `opened`/`closed` |
| `deps.files` | `fileService`: `readFile`, `writeFile(ctx,path,content,baseHash)`, `fingerprint`, `listTree`, `treeByLayer`, `sha256` |
| `deps.watcher` | `watcherService`: `watch(ctx)`, `unwatch(id)`, `ready(id)` |
| `deps.hub` | `wsHub`: `publish(projectId,type,payload)`, `broadcast(type,payload)` |
| `deps.ast` | `astService`: `parseFile`, `print`, `listClassMethods`, `roundTrip` |
| `deps.ext` | objeto livre: uma fase pode pendurar o proprio servico (`deps.ext.blocks = createBlockService(deps)`). Como a carga e alfabetica, quem depende de `deps.ext.x` deve ter nome de arquivo que venha **depois** do de quem o define (ou instanciar o servico direto via `require('../blocks/...')`) |

Convencoes:

- Rotas de projeto: `/api/projects/:id/...` e obtenha o contexto com `deps.registry.require(req.params.id)`.
- Handlers async: envolva com `asyncHandler` (`src/util/asyncHandler.js`); erros: `throw new HttpError(status, 'CODIGO', 'mensagem', {detalhes})` (`src/util/httpError.js`) -> resposta `{ error, code, ...detalhes }`.
- Nunca use `path.join(ctx.rootPath, userInput)` direto: use `ctx.resolvePath(rel)` (anti traversal) ou `ctx.assertAccessible(rel)` (tambem aplica `ignore`).
- Auth por token ja e aplicado a tudo em `/api` (exceto `/api/health`).

Rotas existentes (fundacao):

| Metodo e rota | Resposta |
|---------------|----------|
| `GET /api/health` | `{ status:'ok', version, uptimeSec, projects, authRequired }` |
| `GET /api/projects` | `{ projects: ProjectInfo[] }` (`id, name, rootPath, hasManifest, layers[], ignore[]`) |
| `GET /api/projects/:id` | `ProjectInfo` |
| `GET /api/projects/:id/tree` | `{ projectId, name, layers: [{ id, path, basePath, editor, exists, children }], other: [...] }`; nos: `{ name, path, type:'dir'\|'file', children? }`; respeita `ignore` |
| `GET /api/projects/:id/file?path=` | `{ path, content, hash, mtimeMs, size, layer }` (403 `PATH_TRAVERSAL`/`PATH_IGNORED`, 404, 413, 415 binario) |
| `PUT /api/projects/:id/file?path=` | body `{ content, baseHash }`. `baseHash` e **obrigatorio** (`null` = criar arquivo novo). 200 `{ path, hash, mtimeMs, size, created }`; **409** `{ code:'CONFLICT', baseHash, currentHash, currentContent }` se o disco divergiu. `hash` = sha256 hex dos bytes; o `mtimeMs` e informativo (a autoridade do conflito e o hash) |

#### 1.2 Servicos — `src/services/<nome>.js`

Fabricas puras (`createXService({ ...deps })`), sem estado global oculto, instanciadas pela fase que as cria
(em seu proprio modulo de rotas ou em `src/<fase>/`). Servicos da fundacao (nao editar): `fileService`, `watcherService`,
`wsHub`, `astService`.

`astService` (contrato para blocos/layers):

- `parseFile(source)` -> AST (File do Babel + recast); `print(ast)` -> texto (so reescreve o que mudou);
  `roundTrip(source)` -> **identico** a `source` se nada mudou (garantido por teste sobre os 188 `.js` de `api/@core/usecase` e `api/@core/domain`).
- `listClassMethods(ast)` -> `[{ className, name, async, static, generator, kind, range:{start,end}, loc:{start:{line,column},end:{...}} }]`
  (`range` = offsets no texto original).
- Ao alterar a AST, mexa **so** nos nos necessarios (recast preserva o resto). Detecta CRLF/LF e BOM automaticamente.

#### 1.3 Projeto ativo — `src/context/projectContext.js`

`ProjectContext`: `id`, `rootPath`, `manifest` (de `studio.project.json`, com defaults), `layers[]`
(`{ id, path, basePath, editor, ... }`; `basePath` = parte fixa antes de placeholders como `{Entity}`),
`ignore[]`, `isIgnored(rel)`, `resolvePath(rel)`, `assertAccessible(rel)`, `layerOf(rel)`, `reload()`, `toJSON()`.
Defaults de camadas reproduzem `api/`: domain=`@core/domain`, usecase=`@core/usecase`, repository=`infrastructure/db/services`,
controller=`infrastructure/Controllers`, routes=`infrastructure/routes`, worker=`infrastructure/queue/workers`,
gateway=`infrastructure/gateways`, migration=`knex/migrations`; ignore=`.env`, `security`, `Logs`, `node_modules`, `.git`.
O registro suporta varios projetos (`registry.open(rootPath)` em qualquer momento; o watcher acompanha automaticamente).

> A fase `projects` expande criacao/import/recentes **usando** `registry.open/close` e escrevendo o
> `studio.project.json`; ela nao precisa alterar `projectContext.js` (se precisar de um campo novo do manifesto,
> ele ja aparece em `ctx.manifest`, pois campos desconhecidos sao preservados).

#### 1.4 WebSocket — `deps.hub`

Endpoint `/ws` (`?token=` quando houver token; `?project=<id>` assina na conexao). Mensagens
servidor->cliente: `{ type, projectId, payload, ts }`. Cliente->servidor: `{type:'subscribe'|'unsubscribe', projectId}`, `{type:'ping'}`.
Publique com `deps.hub.publish(projectId, 'dominio:evento', payload)`.

Eventos existentes: `file:changed | file:added | file:removed` (`{ path, layer, hash?, mtimeMs? }` — o `hash` permite
ignorar o eco das proprias gravacoes), `tree:changed` (`{ path, kind:'dirAdded'|'dirRemoved' }`), `watcher:error`,
`hello` (conexao), `pong`. Evento generico para o painel de logs da UI: `log:line` com `{ level:'info'|'warn'|'error', message, source? }`.
Novos eventos: use prefixo da fase (`blocks:*`, `infra:*`, `projects:*`).

### 2. UI — layout fixo

```
studio/ui/src/
  main.tsx                       boot; carrega src/features/*/register.ts
  App.tsx                        composicao do layout (abas de projeto | explorador | editor | painel inferior) — NAO editar
  api/client.ts, api/types.ts    REST + WebSocket com reconexao (NAO editar; use `api.request` e `studioSocket.on`)
  state/store.ts                 estado compartilhado minimo (projetos, projeto ativo, arquivos abertos, logs)
  features/<nome>/               *** UMA PASTA POR FEATURE/FASE ***
    register.ts                  (opcional) registra editores/paineis — carregado automaticamente
  features/registrations.ts      loader dos register.ts (NAO editar)
  features/editors/registry.ts   REGISTRO de editores por camada (ponto de extensao)
  features/panels/registry.ts    REGISTRO de paineis inferiores (ponto de extensao)
  features/{explorer,editor,logs,projects}/   features da fundacao
```

Cada fase cria **sua pasta** em `src/features/<nome>/` (ex.: `blocks/`, `domain/`, `migration/`, `infra/`, `projects/`)
e chama os registros no `register.ts` dela — sem editar `App.tsx`. A fase `projects` e dona de `features/projects/`
(pode reescrever `ProjectTabs.tsx`); `features/explorer`, `features/editor` e `features/logs` pertencem a fundacao
(se uma fase precisar mudar algo ali, abra a mudanca como extensao via registro, nao edicao).

#### 2.1 Editores por camada — `src/features/editors/registry.ts`

Mapa `layerId -> componente` (`LayerEditorComponent = ComponentType<{ projectId, path, layer }>`). Sem entrada = Monaco.

```ts
// src/features/blocks/register.ts   (arquivo NOVO da fase)
import { registerLayerEditor } from '../editors/registry';
import { BlocksEditor } from './BlocksEditor';
registerLayerEditor('usecase', BlocksEditor);
```

- O unico arquivo existente que pode ser editado para registrar um editor e o proprio `registry.ts` (objeto `layerEditors`); o caminho preferido e o `register.ts`.
- Camadas padrao e editor sugerido: `domain` -> formulario de campos; `usecase` -> canvas de blocos; `migration` -> designer de tabela; `routes`/`controller` -> tabela de rotas; `worker` -> canvas.
- Quando uma camada tem editor proprio, o cabecalho ganha o botao **"Ver como texto"** (Monaco sobre o mesmo arquivo).
- Dentro do seu editor use `useFileDocument(projectId, path)` (`src/features/editor/useFileDocument.ts`): entrega
  `value/dirty/save/reload/overwrite/conflict/externalChange`, com checagem de hash (409) e recarga/aviso quando o watcher notifica mudanca externa.

#### 2.2 Paineis inferiores — `src/features/panels/registry.ts`

```ts
import { registerBottomPanel } from '../panels/registry';
registerBottomPanel({ id: 'operacao', title: 'Operacao', order: 20, component: OperacaoPanel });
```

#### 2.3 Logs e estado

`studioActions.log('info'|'warn'|'error', mensagem, { projectId, source })` escreve no painel Logs.
Estado novo de uma feature deve ficar **na propria feature** (hooks/contexto locais); `state/store.ts` so guarda o que e realmente compartilhado.

### 3. Testes

`studio/server/test/*.test.js` (jest). Existentes: `roundtrip.test.js` (zero diff nos `.js` de `api/@core/usecase|domain`,
somente leitura), `files.test.js` (traversal, 409, ignore, token), `watcher.test.js` (chokidar + WebSocket).
`test/helpers.js` cria projetos temporarios (`createTempProject`). Cada fase adiciona `test/<fase>.test.js`.
**Os testes nunca escrevem em `api/`.**

### 4. Docker / compose

`studio/server/Dockerfile` e `studio/ui/Dockerfile` sao de desenvolvimento (monte `./studio/server:/app` e
`./studio/ui:/app`, com volume anonimo para `/app/node_modules`). A edicao do `docker-compose.yaml` (servicos
`studioserver`/`studioui`, `profiles`, mapeamento `./api` etc., portas restritas a `127.0.0.1`) e da fase `infra`.

---

## Decisoes e notas

- **Round-trip**: `@babel/parser` com `sourceType:'unambiguous'` e `tokens:true`, via `recast`; o terminador de linha
  original (CRLF/LF) e repassado ao `print` (o recast usaria `os.EOL`). Resultado: zero diff nos 188 arquivos de `api/@core`.
- **Conflito**: a autoridade e o hash sha256 do conteudo (`baseHash`); `mtime` e retornado apenas como informacao
  (um `touch` sem mudanca de conteudo nao gera conflito). Gravacoes sao atomicas e serializadas por arquivo.
- **Monaco local**: o Monaco e empacotado (sem CDN) para funcionar em container/rede restrita; carregado sob demanda.
- **chokidar 3**: `fsevents` e opcional; o `usePolling` so e repassado quando `STUDIO_WATCH_POLLING=true`.
