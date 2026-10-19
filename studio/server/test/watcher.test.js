'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createTempProject } = require('./helpers');

function waitFor(predicate, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const v = predicate();
      if (v) return resolve(v);
      if (Date.now() - start > timeout) return reject(new Error('timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('watcher + WebSocket', () => {
  let t;
  let ws;
  const received = [];

  beforeEach(async () => {
    received.length = 0;
    t = createTempProject({}, { watch: true });
    await t.studio.deps.watcher.ready('teste');
    await new Promise((resolve) => t.studio.server.listen(0, '127.0.0.1', resolve));
    const { port } = t.studio.server.address();
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws?project=teste`);
    ws.on('message', (d) => received.push(JSON.parse(d.toString())));
    await waitFor(() => received.some((m) => m.type === 'hello'));
  });

  afterEach(async () => {
    ws.terminate();
    await t.cleanup();
  });

  it('emite file:changed com hash para o canal do projeto', async () => {
    fs.writeFileSync(path.join(t.root, 'index.js'), 'console.log("novo");\n');
    const msg = await waitFor(() => received.find((m) => m.type === 'file:changed' && m.payload.path === 'index.js'));
    expect(msg.projectId).toBe('teste');
    expect(msg.payload.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('emite file:added e file:removed', async () => {
    const f = path.join(t.root, '@core/domain/Novo.js');
    fs.writeFileSync(f, 'x');
    const added = await waitFor(() => received.find((m) => m.type === 'file:added' && m.payload.path === '@core/domain/Novo.js'));
    expect(added.payload.layer).toBe('domain');
    fs.unlinkSync(f);
    await waitFor(() => received.find((m) => m.type === 'file:removed' && m.payload.path === '@core/domain/Novo.js'));
  });

  it('nao emite eventos de arquivos ignorados', async () => {
    fs.writeFileSync(path.join(t.root, '.env'), 'X=2\n');
    fs.writeFileSync(path.join(t.root, 'security/chave.pem'), 'novo');
    fs.writeFileSync(path.join(t.root, 'marcador.js'), 'x');
    await waitFor(() => received.find((m) => m.payload && m.payload.path === 'marcador.js'));
    expect(received.filter((m) => m.payload && /\.env|security/.test(m.payload.path || ''))).toEqual([]);
  });

  it('hub.publish entrega so a quem assinou o canal', async () => {
    expect(t.studio.deps.hub.publish('teste', 'custom:evento', { a: 1 })).toBe(1);
    expect(t.studio.deps.hub.publish('outro', 'custom:evento', {})).toBe(0);
    await waitFor(() => received.find((m) => m.type === 'custom:evento'));
  });

  it('grava via API e o proprio hash chega no evento (permite ignorar o eco)', async () => {
    const request = require('supertest');
    const r = await request(t.studio.app).get('/api/projects/teste/file').query({ path: 'index.js' });
    const w = await request(t.studio.app)
      .put('/api/projects/teste/file')
      .query({ path: 'index.js' })
      .send({ content: 'console.log("api");\n', baseHash: r.body.hash });
    const msg = await waitFor(() => received.find((m) => m.type === 'file:changed' && m.payload.hash === w.body.hash));
    expect(msg.payload.path).toBe('index.js');
  });
});
