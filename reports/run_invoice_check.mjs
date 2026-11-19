import { readFileSync } from 'node:fs';

// Minimal TS stripper for the domain module (types only, no enums/decorators).
function stripTs(src) {
  return src
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/^export (interface|type)[\s\S]*?^}\s*$/gm, '')
    .replace(/^export type[\s\S]*?;\s*$/gm, '')
    .replace(/(\b(?:const|let|function)\s+\w+)\s*:\s*[^=;]+(?==|;)/g, '$1')
    .replace(/\(([^)]*:\s*[^)]*)\)/g, (m) => m.replace(/:\s*[^,)]+/g, ''))
    .replace(/ as (?:const|number|string|unknown|InvoiceColumn|ReadonlyArray<[^>]*>|Array<[^>]*>)/g, '')
    .replace(/\?\./g, '.')
    .replace(/^\s*\/\/.*$/gm, '');
}
const src = readFileSync('src/domain/invoice.ts', 'utf8');
console.log(stripTs(src).slice(0, 500));
