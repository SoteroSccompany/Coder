const express = require('express');
const IndexExemploUseCase = require('./@core/usecase/Exemplo/indexExemploUseCase');

const app = express();
const port = Number(process.env.PORT || {{port}});
const exemplo = new IndexExemploUseCase();

app.get('/healthcheck', async (req, res) => {
  const out = await exemplo.executar({ ping: true });
  res.status(out.status ? 200 : 500).json({ status: 'ok', exemplo: out });
});

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log('{{name}} em http://0.0.0.0:' + port);
  });
}

module.exports = app;
