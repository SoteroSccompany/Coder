# Biblioteca global de blocos

Blocos globais do Coder Studio. Um bloco do projeto em `<projeto>/.studio/blocks/` **sobrescreve**
um global de mesmo `id`. O manifesto `blocks` pode listar ids (`categoria.nome`) para filtrar a
biblioteca, ou caminhos extras dentro do projeto; `core` significa esta pasta. Sem o campo, entram
todos os globais mais os do projeto.

## Layout

```
studio/blocks/<categoria>/<nome>.block.json
```

Exemplos de categorias: `fluxo`, `dados`, `seguranca`, `infra`, `livre`.
Blocos especificos de um projeto ficam em `<projeto>/.studio/blocks/` e **sobrescrevem** um bloco global de mesmo `id`.

## Formato `.block.json`

| Campo | Descricao |
|-------|-----------|
| `id` | identificador unico e estavel (ex.: `dados.transacao-knex`) |
| `label` | nome exibido no canvas |
| `categoria` | categoria/paleta |
| `icone` | icone/cor opcional |
| `slots` | entradas tipadas (variavel, expressao, string, enum de repositorio/entidade) e saidas (variavel declarada) |
| `imports` | `require()` que precisam existir no topo do arquivo (adicionados/removidos automaticamente) |
| `template` | codigo JS com placeholders dos slots |
| `pattern` | padrao de AST (derivado do template) usado para reconhecer o bloco ao abrir um arquivo |
| `containers` | quando o bloco aceita filhos (if, transacao, try/catch) |

Regras gerais (ver plano):

- O codigo `.js` e a fonte da verdade; o bloco e uma *visao* do AST. Statement que nao casa com nenhum
  bloco vira o bloco **"Codigo livre"**.
- Comentario opcional `// @block:<id>` desambigua padroes parecidos.
- O reconhecimento deve ser conservador: na duvida, cair em "Codigo livre" em vez de reescrever errado.

Placeholders do template: `{{slot}}` (expressao/variavel) e `{{#container}}` (filhos, uma linha sozinha).
`templates` (mapa por `variant`) cobre formas alternativas do mesmo bloco, por exemplo Se sem Senao
ou ledger com `Initialize`.

O `pattern` aceita:

- DSL `{ "kind": "call" | "new" | "guard" | "return-status" | "if-else" | "try-log" | "transaction" | "ledger" | "publish" }`
  com filtros `objectName` / `objectMatch`, `methodName` / `methodMatch`, `ctorName` / `ctorMatch`, `await`.
- AST `{ "type": "..." }` ou `{ "sequence": [...] }`, gerado pelo criador. `$bind` captura um pedaco
  (`$as: "expr"` aceita qualquer expressao) e `$container` marca o corpo de filhos.

Cada metodo da classe e um fluxo. O try/catch com `logExeption` e um container em volta do corpo
quando o catch chama `ErrorStackParser.parse` e `logExeption`.

## Blocos iniciais

| id | O que reconhece |
|----|-----------------|
| `fluxo.se-senao` | `if` com bloco (e `else` opcional) |
| `fluxo.retornar-status` | `return { status, msg }` so com essas duas chaves |
| `fluxo.guard-status` | `if (!alvo.status) return { status: false, msg }` |
| `fluxo.try-catch-log` | try/catch externo com `logExeption` |
| `dados.chamar-repositorio` | `await repository*.metodo(...)` |
| `dados.buscar-usuario` | `await GetUserUsecase.getById(...)` |
| `dados.instanciar-domain` | `new domain*` |
| `dados.transacao-knex` | `knex.transaction()` + try com commit/rollback |
| `dados.gravar-auditoria` | `new Ledger*` + `GravarAuditoria*` (com `Initialize` opcional) |
| `seguranca.sha` | `new SHA` e `sha.encrypt/hash/decrypt` |
| `seguranca.bcrypt` | `new BCRYPT` e `bcrypt.encrypt/compare` |
| `seguranca.otp-qrcode` | `authenticator.generate*` / `verify` e `qrCode.toDataURL` |
| `infra.publicar-fila` | `new MessageDispatcher` + `addItem` + `dispatch` |
| `infra.consumir-fila` | `consumeMessage` |
| `infra.cache-redis` | `get`/`set`/`del` num objeto com redis/cache no nome |
| `infra.enviar-email` | chamada `sendEmail*` / `enviarEmail*` |
| `infra.upload-bucket` | `urlUploadPut` ou metodo conhecido em `bucket*` |
| `livre.codigo-livre` | fallback; guarda o texto original |
| `livre.comentario` | statement vazio ou bloco inserido na paleta |

Fica de proposito como codigo livre o que nao e estavel: `if` que devolve direto mas nao e
`!x.status` (ou o return traz campos alem de status/msg), atribuicoes soltas, `sha.hash(...)`
dentro de outra condicao, `bcrypt.encrypt` dentro de um `map`, e o return grande com qrcode/objetos.

## API

| Metodo | Rota |
|--------|------|
| GET | `/api/blocks` — biblioteca global |
| GET | `/api/projects/:id/blocks` — global + projeto |
| GET | `/api/projects/:id/blocks/flow?path=&method=` |
| PUT | `/api/projects/:id/blocks/flow?path=` body `{ method, className?, blocks, baseHash }` (409 `CONFLICT`) |
| POST | `/api/projects/:id/blocks` body `{ code, id, label, categoria, params, scope?: "project"\|"global" }` |

Abrir e salvar sem editar devolve o arquivo byte a byte. O canvas (Blockly) e o editor da camada
`usecase`, com Monaco ao lado para a acao "Transformar selecao em bloco".

## Dono desta pasta

Fases `blocks-engine`, `initial-blocks` e `block-creator`. Arquivos novos de blocos nao conflitam entre si
(um arquivo por bloco).
