try {
  require('dotenv').config();
} catch (err) {
  // dotenv entra no npm install; fora dele a API ainda sobe com as variaveis do ambiente
}

const express = require('express');
const routes = require('./infrastructure/routes');

const app = express();
app.use(express.json());
app.use(routes);

const port = Number(process.env.PORT || {{port}});

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log('{{name}} em http://0.0.0.0:' + port);
  });
}

module.exports = app;
