'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

/** Cria um projeto temporario com arquivos (e um `.env`/`security` secretos) e abre no app. */
function createTempProject(files = {}, { watch = false, manifest } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-')));
  const base = {
    '.env': 'SEGREDO=1\n',
    'security/chave.pem': 'PEM\n',
    'Logs/a.log': 'log\n',
    'node_modules/x/index.js': 'module.exports = 1;\n',
    '@core/domain/Foo.js': 'class Foo {}\nmodule.exports = Foo;\n',
    '@core/usecase/Foo/createFooUseCase.js': 'class A { async run() { return 1; } }\nmodule.exports = A;\n',
    'infrastructure/routes/foo.js': 'module.exports = {};\n',
    'index.js': 'console.log(1);\n',
    ...files,
  };
  if (manifest) base['studio.project.json'] = JSON.stringify(manifest);
  for (const [rel, content] of Object.entries(base)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const studio = createApp({ watch });
  const ctx = studio.deps.registry.open(root, { id: 'teste' });
  const cleanup = async () => {
    await studio.close();
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { studio, ctx, root, cleanup };
}

module.exports = { createTempProject };
