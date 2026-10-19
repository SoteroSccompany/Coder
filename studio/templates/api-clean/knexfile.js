require('dotenv').config();

const shared = {
  client: process.env.DB_CLIENT || 'mysql2',
  connection: {
    database: process.env.DB_DATABASE || '{{database}}',
    user: process.env.DB_USER || '{{dbUser}}',
    password: process.env.DB_PASS || '',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || {{dbPort}}),
  },
  pool: { min: 0, max: 10 },
  migrations: {
    tableName: 'knex_migrations',
    directory: './knex/migrations',
  },
  seeds: {
    directory: './knex/seeds',
  },
};

module.exports = {
  development: shared,
  production: shared,
};
