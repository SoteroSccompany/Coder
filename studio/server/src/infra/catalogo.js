'use strict';

/**
 * Catalogo de servicos de infra por projeto.
 * Cada item traz o trecho de compose, variaveis para env-example.txt,
 * o esqueleto do gateway e a lista de ids de blocos (os .block.json nao sao criados aqui).
 *
 * Segredos nao sao preenchidos: os valores apontam para variaveis de ambiente.
 */

const CATALOGO = [
  {
    id: 'mysql',
    titulo: 'MySQL',
    descricao: 'Banco relacional',
    porta: 3306,
    envHost: 'DB_HOST',
    envPort: 'DB_PORT',
    envExtras: ['DB_CLIENT', 'DB_USER', 'DB_PASS', 'DB_PASS_USER', 'DB_DATABASE'],
    env: [
      'DB_CLIENT=mysql2',
      'DB_HOST=mysql',
      'DB_PORT=3306',
      'DB_USER=',
      'DB_PASS=',
      'DB_PASS_USER=',
      'DB_DATABASE=',
    ],
    blocos: ['infra.mysql.conectar', 'infra.mysql.query'],
    yaml: [
      '  mysql:',
      '    image: mysql:8.4',
      '    restart: unless-stopped',
      '    environment:',
      '      MYSQL_ROOT_PASSWORD: ${DB_PASS}',
      '      MYSQL_DATABASE: ${DB_DATABASE}',
      '      MYSQL_USER: ${DB_USER}',
      '      MYSQL_PASSWORD: ${DB_PASS_USER}',
      '    ports:',
      '      - "${DB_PORT}:3306"',
      '    volumes:',
      '      - ./.docker/mysql:/var/lib/mysql',
    ].join('\n'),
  },
  {
    id: 'redis',
    titulo: 'Redis',
    descricao: 'Cache e chaves volateis',
    porta: 6379,
    envHost: 'REDIS_HOST',
    envPort: 'REDIS_PORT',
    envExtras: ['REDIS_PASS'],
    env: ['REDIS_HOST=redis', 'REDIS_PORT=6379', 'REDIS_PASS='],
    blocos: ['infra.redis.get', 'infra.redis.set'],
    yaml: [
      '  redis:',
      '    image: redis:7-alpine',
      '    restart: unless-stopped',
      '    ports:',
      '      - "${REDIS_PORT}:6379"',
      '    volumes:',
      '      - ./.docker/redis:/data',
    ].join('\n'),
  },
  {
    id: 'rabbitmq',
    titulo: 'RabbitMQ',
    descricao: 'Filas',
    porta: 5672,
    envHost: 'RABBITMQ_HOST',
    envPort: 'RABBITMQ_PORT',
    envExtras: ['RABBITMQ_DEFAULT_USER', 'RABBITMQ_DEFAULT_PASS', 'RABBITMQ_WEB_PORT'],
    env: [
      'RABBITMQ_HOST=rabbitmq',
      'RABBITMQ_PORT=5672',
      'RABBITMQ_WEB_PORT=15672',
      'RABBITMQ_DEFAULT_USER=',
      'RABBITMQ_DEFAULT_PASS=',
    ],
    blocos: ['infra.rabbitmq.publicar', 'infra.rabbitmq.consumir'],
    yaml: [
      '  rabbitmq:',
      '    image: rabbitmq:3-management',
      '    restart: unless-stopped',
      '    environment:',
      '      RABBITMQ_DEFAULT_USER: ${RABBITMQ_DEFAULT_USER}',
      '      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_DEFAULT_PASS}',
      '    ports:',
      '      - "${RABBITMQ_PORT}:5672"',
      '      - "${RABBITMQ_WEB_PORT}:15672"',
    ].join('\n'),
  },
  {
    id: 'mailpit',
    titulo: 'Mailpit',
    descricao: 'SMTP de desenvolvimento (captura e-mails)',
    porta: 1025,
    envHost: 'MAILPIT_HOST',
    envPort: 'MAILPIT_SMTP_PORT',
    envExtras: ['MAILPIT_UI_PORT'],
    env: ['MAILPIT_HOST=mailpit', 'MAILPIT_SMTP_PORT=1025', 'MAILPIT_UI_PORT=8025'],
    blocos: ['infra.mail.enviar'],
    yaml: [
      '  mailpit:',
      '    image: axllent/mailpit:latest',
      '    restart: unless-stopped',
      '    ports:',
      '      - "${MAILPIT_UI_PORT}:8025"',
      '      - "${MAILPIT_SMTP_PORT}:1025"',
    ].join('\n'),
  },
  {
    id: 'minio',
    titulo: 'MinIO',
    descricao: 'Armazenamento compativel com S3',
    porta: 9000,
    envHost: 'MINIO_HOST',
    envPort: 'MINIO_PORT',
    envExtras: ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'MINIO_CONSOLE_PORT'],
    env: [
      'MINIO_HOST=minio',
      'MINIO_PORT=9000',
      'MINIO_CONSOLE_PORT=9001',
      'MINIO_ROOT_USER=',
      'MINIO_ROOT_PASSWORD=',
    ],
    blocos: ['infra.minio.upload', 'infra.minio.download'],
    yaml: [
      '  minio:',
      '    image: minio/minio:latest',
      '    command: ["server", "/data", "--console-address", ":9001"]',
      '    restart: unless-stopped',
      '    environment:',
      '      MINIO_ROOT_USER: ${MINIO_ROOT_USER}',
      '      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}',
      '    ports:',
      '      - "${MINIO_PORT}:9000"',
      '      - "${MINIO_CONSOLE_PORT}:9001"',
      '    volumes:',
      '      - ./.docker/minio:/data',
    ].join('\n'),
  },
  {
    id: 'meilisearch',
    titulo: 'Meilisearch',
    descricao: 'Busca textual',
    porta: 7700,
    envHost: 'MEILI_HOST',
    envPort: 'MEILI_PORT',
    envExtras: ['MEILI_MASTER_KEY'],
    env: ['MEILI_HOST=meilisearch', 'MEILI_PORT=7700', 'MEILI_MASTER_KEY='],
    blocos: ['infra.meilisearch.buscar', 'infra.meilisearch.indexar'],
    yaml: [
      '  meilisearch:',
      '    image: getmeili/meilisearch:latest',
      '    restart: unless-stopped',
      '    environment:',
      '      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}',
      '      MEILI_ENV: development',
      '    ports:',
      '      - "${MEILI_PORT}:7700"',
      '    volumes:',
      '      - ./.docker/meili:/meili_data',
    ].join('\n'),
  },
  {
    id: 'postgres',
    titulo: 'Postgres',
    descricao: 'Banco relacional',
    porta: 5432,
    envHost: 'POSTGRES_HOST',
    envPort: 'POSTGRES_PORT',
    envExtras: ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'],
    env: [
      'POSTGRES_HOST=postgres',
      'POSTGRES_PORT=5432',
      'POSTGRES_USER=',
      'POSTGRES_PASSWORD=',
      'POSTGRES_DB=',
    ],
    blocos: ['infra.postgres.conectar', 'infra.postgres.query'],
    yaml: [
      '  postgres:',
      '    image: postgres:16-alpine',
      '    restart: unless-stopped',
      '    environment:',
      '      POSTGRES_USER: ${POSTGRES_USER}',
      '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}',
      '      POSTGRES_DB: ${POSTGRES_DB}',
      '    ports:',
      '      - "${POSTGRES_PORT}:5432"',
      '    volumes:',
      '      - ./.docker/postgres:/var/lib/postgresql/data',
    ].join('\n'),
  },
];

function listarCatalogo() {
  return CATALOGO.map((item) => ({
    id: item.id,
    titulo: item.titulo,
    descricao: item.descricao,
    porta: item.porta,
    env: item.env,
    blocos: item.blocos,
    gateway: `infrastructure/gateways/${item.id}/index.js`,
  }));
}

function obterServico(id) {
  return CATALOGO.find((item) => item.id === id) || null;
}

function renderGateway(item) {
  const extras = (item.envExtras || [])
    .map((nome) => `        ${nome}: process.env.${nome} || '',`)
    .join('\n');
  return `'use strict';

/**
 * Gateway ${item.id} — gerado pelo Coder Studio.
 * Le somente variaveis de ambiente. Nao grave segredos neste arquivo.
 */
function criar() {
    return {
        id: '${item.id}',
        host: process.env.${item.envHost} || '127.0.0.1',
        port: Number(process.env.${item.envPort} || ${item.porta}),
${extras}
    };
}

module.exports = { criar };
`;
}

module.exports = { listarCatalogo, obterServico, renderGateway, CATALOGO };
