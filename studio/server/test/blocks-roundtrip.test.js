'use strict';

/**
 * Round-trip dos use cases: decompor cada metodo e regerar o arquivo inteiro
 * tem de ser identico ao original. So leitura de api/.
 */

const fs = require('fs');
const path = require('path');
const { createBlockService } = require('../src/blocks/service');
const ast = require('../src/services/astService');

const API = path.resolve(__dirname, '../../../api/@core/usecase');
const svc = createBlockService({ ast, files: null, config: {} });

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

const files = walk(API).sort();

describe('round-trip de blocos (api/@core/usecase)', () => {
  it('encontra arquivos', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.map((f) => [path.relative(API, f), f]))('%s -> zero diff', (_rel, abs) => {
    const source = fs.readFileSync(abs, 'utf8');
    const flow = svc.decompose(source, null);
    let out = source;
    for (const m of flow.methods) {
      out = svc.apply(out, { className: m.className, method: m.name, blocks: m.blocks }, null);
    }
    expect(out).toBe(source);
  });
});
