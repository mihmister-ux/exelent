import { readFileSync } from 'node:fs';

// Tiny TS→JS for the two domain files (they only use type annotations).
function compile(file) {
  let src = readFileSync(file, 'utf8');
  src = src.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '');
  src = src.replace(/^export (interface|type)[\s\S]*?^}\s*$/gm, '');
  src = src.replace(/^export type[\s\S]*?;\s*$/gm, '');
  src = src.replace(/\b(interface|type)\s+\w+\s*=\s*[^;]+;/g, '');
  src = src.replace(/(\b(?:const|let|function)\s+\w+)\s*:\s*[^=;]+(?==|;|\s*\()/g, '$1');
  src = src.replace(/\(([^()]*:\s*[^()]*)\)/g, (m) => m.replace(/:\s*[^,)]+/g, ''));
  src = src.replace(/\bas const\b/g, '');
  src = src.replace(/^\s*\/\/.*$/gm, '');
  src = src.replace(/^export /gm, '');
  return src;
}

const datesSrc = compile('src/lib/dates.ts');
const invoiceSrc = compile('src/domain/invoice.ts');

const factory = new Function(
  datesSrc + '\n' + invoiceSrc + '\nreturn { parseInvoiceSheet, parseInvoice, parseNumber };',
);
const { parseInvoiceSheet } = factory();

const N = null;
function fit(r, w = 60) { return [...r.slice(0, w), ...Array(Math.max(0, w - r.length)).fill(N)]; }

const header = fit(['№', N, 'Товар (Услуга)', ...Array(20).fill(N), 'Код', ...Array(11).fill(N), 'Кол-во', ...Array(4).fill(N), 'Ед.', ...Array(2).fill(N), 'Цена', ...Array(4).fill(N), 'Скидка', ...Array(4).fill(N), 'Сумма', ...Array(5).fill(N)]);
const numbering = fit(['1', N, '2', ...Array(18).fill(N), '3', ...Array(11).fill(N), '4', ...Array(4).fill(N), '5', ...Array(2).fill(N), '6', ...Array(4).fill(N), '7', ...Array(4).fill(N), '8', ...Array(5).fill(N)]);
const goods = fit(['1', N, 'Панталфит-5 Премиум (для суставов), 30 бриктов по 2г', ...Array(18).fill(N), '4660000647252', ...Array(11).fill(N), 5, ...Array(4).fill(N), 'шт', ...Array(2).fill(N), 365, ...Array(4).fill(N), '54,75', ...Array(4).fill(N), 1770.25, ...Array(5).fill(N)]);

const result = parseInvoiceSheet({ name: 'Лист_1', rows: [header, numbering, goods] });
console.log(JSON.stringify({
  headerRow: result?.headerRow,
  columns: result?.columns,
  skipped: result?.skipped,
  rows: result?.rows.map((r) => ({ number: r.number, name: r.name, qty: r.quantity, price: r.price, amount: r.amount, warning: r.warning })),
}, null, 2));
