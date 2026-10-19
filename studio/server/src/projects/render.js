'use strict';

/**
 * Placeholders dos templates: {{chave}} e blocos {{#if servico}} ... {{/if}}.
 * Chave desconhecida e preservada (ex.: {{Entity}} dentro de fileTemplates).
 */

function lookup(vars, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
}

function render(text, vars, enabled = {}) {
  const lines = String(text).split('\n');
  const stack = [];
  const active = () => stack.every(Boolean);
  const out = [];
  for (const line of lines) {
    const open = line.match(/^\s*\{\{#if\s+([a-z0-9_-]+)\}\}\s*$/);
    if (open) {
      stack.push(!!enabled[open[1]]);
      continue;
    }
    if (/^\s*\{\{\/if\}\}\s*$/.test(line)) {
      stack.pop();
      continue;
    }
    if (!active()) continue;
    out.push(
      line.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match, key) => {
        const val = lookup(vars, key);
        if (val === undefined || val === null) return match;
        return String(val);
      }),
    );
  }
  return out.join('\n');
}

module.exports = { render };
