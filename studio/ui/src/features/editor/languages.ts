const BY_EXT: Record<string, string> = {
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'html',
  css: 'css',
  sql: 'sql',
  sh: 'shell',
  txt: 'plaintext',
};

export function languageOf(path: string): string {
  const name = path.split('/').pop() || '';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return BY_EXT[ext] || 'plaintext';
}
