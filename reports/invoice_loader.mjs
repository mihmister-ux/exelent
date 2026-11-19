import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const full = (p) => path.join(root, p);
const files = [];
const cache = new Map();

function transform(spec) {
  if (cache.has(spec)) return cache.get(spec);
  const path = full(spec === '@lib/dates' ? 'src/lib/dates.ts' : spec);
  let src = readFileSync(path, 'utf8');
  src = src.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '');
  src = src.replace(/^export (interface|type)[\s\S]*?^}\s*$/gm, '');
  src = src.replace(/^export type[\s\S]*?;\s*$/gm, '');
  src = src.replace(/^export /gm, '');
  src = src.replace(/\b(interface|type)\s+\w+\s*=\s*[^;]+;/g, '');
  src = src.replace(/(\b(?:const|let|function)\s+\w+)\s*:\s*[^=;]+(?==|;)/g, '$1');
  src = src.replace(/\(([^()]*:\s*[^()]*)\)/g, (m) => m.replace(/:\s*[^,)]+/g, ''));
  src = src.replace(/ as (?:const|number|string|unknown|InvoiceColumn|ReadonlyArray<[^>]*>|Array<[^>]*>)/g, '');
  src = src.replace(/^\s*\/\/.*$/gm, '');
  src = src.replace(/(return|const\s+\w+\s*=\s*)\s*\{\s*([^{}]+?)\s*\}\s*;/g, (m, p1, body) => {
    const cleaned = body.replace(/(\b\w+)\s*:\s*([^,}]+)/g, '$1: $2');
    return `${p1} { ${cleaned} };`;
  });
  cache.set(spec, src);
  return src;
}

const Module = (await import('node:module')).default;
const origLoad = Module._extensions['.ts'];
Module._extensions['.ts'] = function (mod, filename) {
  mod._compile(transform(filename), filename);
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (spec, parent, ...rest) {
  if (spec === '@lib/dates') return 'src/lib/dates.ts';
  return origResolve.call(this, spec, parent, ...rest);
};

const invoice = await import('./src/domain/invoice.ts');
export const parseInvoiceSheet = invoice.parseInvoiceSheet;
export const parseInvoice = invoice.parseInvoice;
