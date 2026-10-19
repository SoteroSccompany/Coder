# Templates de projeto

O wizard **Novo projeto** copia uma pasta daqui, troca os placeholders e grava um projeto real em
`<workspace>/projects/<slug>/` (workspace = `STUDIO_WORKSPACE`, padrao: raiz do repositorio).

```
studio/templates/<nome>/
  template.json     # perguntas, servicos sugeridos, blocos, camadas
  ...               # arquivos com {{name}}, {{slug}}, {{port}}, {{database}}, ...
```

Templates internos: `api-clean`, `api-minima`, `worker-fila`.

## Salvar um projeto como template

- Pasta do usuario (padrao): `<workspace>/.studio/templates/<nome>/`
  (ou `STUDIO_USER_TEMPLATES`, se definido). O `.env` real nao entra na copia.
- Pasta interna: `studio/templates/<nome>/`. Os nomes `api-clean`, `api-minima` e `worker-fila`
  so sao sobrescritos com confirmacao explicita.

O `docker-compose.yaml` de cada template e reescrito na criacao para incluir so os servicos
escolhidos (mysql, redis, rabbitmq, mailpit) numa rede propria do projeto, sem `external: true`.
