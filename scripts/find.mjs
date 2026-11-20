#!/usr/bin/env node
/**
 * find.mjs — поиск по проекту скриптом вместо чтения файлов в чат.
 *
 * Зачем: агент, открывающий файл целиком, платит токенами за каждую строку.
 * Здесь платится только за совпадения + контекст.
 *
 * Примеры:
 *   node scripts/find.mjs supplierId --files src/db/types.ts,src/db/supplier-links.ts
 *   node scripts/find.mjs "registerSW|workbox" --dir src --ctx 2
 *   node scripts/find.mjs "TODO|FIXME" --ext ts,tsx --max 20
 *   node scripts/find.mjs supplierId --files src/db/types.ts --count   (только число)
 *
 * Коды выхода: 0 — найдено (или --count), 1 — ничего не найдено, 2 — ошибка аргументов.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, resolve, basename } from "node:path";

const DEFAULT_SKIP = new Set([
  "node_modules", ".git", "dist", "reports", ".npm-cache", "coverage",
]);

function parseArgs(argv) {
  const opts = {
    pattern: null, files: [], dirs: [], ext: ["ts", "tsx", "mjs", "js", "json", "md", "css", "html"],
    ctx: 0, max: 60, count: false, caseSensitive: false, skip: new Set(DEFAULT_SKIP), lines: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`аргумент ${a} требует значения`);
      return v;
    };
    if (a === "--files") opts.files.push(...next().split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--dir") opts.dirs.push(next());
    else if (a === "--ext") opts.ext = next().split(",").map((s) => s.trim().replace(/^\./, ""));
    else if (a === "--ctx") opts.ctx = Number(next());
    else if (a === "--max") opts.max = Number(next());
    else if (a === "--skip") next().split(",").forEach((s) => opts.skip.add(s.trim()));
    else if (a === "--count") opts.count = true;
    else if (a === "--lines") opts.lines = true;
    else if (a === "-i") opts.caseSensitive = false;
    else if (a === "-s") opts.caseSensitive = true;
    else if (a.startsWith("-")) fail(`неизвестный флаг ${a}`);
    else if (opts.pattern === null) opts.pattern = a;
    else fail(`лишний аргумент: ${a}`);
  }
  if (!opts.pattern) fail("нужен шаблон поиска");
  if (!opts.files.length && !opts.dirs.length) opts.dirs.push("src");
  return opts;
}

function fail(msg) {
  console.error(`find.mjs: ${msg}`);
  process.exit(2);
}

function walk(dir, opts, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (opts.skip.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, opts, out);
    else if (opts.ext.includes(extname(entry.name).slice(1))) out.push(full);
  }
}

/** Сколько строк в файле — для отчёта «сколько сэкономили». */
function lineCount(file) {
  try {
    const text = readFileSync(file, "utf8");
    return { lines: text.split(/\r?\n/).length, bytes: Buffer.byteLength(text) };
  } catch {
    return { lines: 0, bytes: 0 };
  }
}

const opts = parseArgs(process.argv.slice(2));
const re = new RegExp(opts.pattern, opts.caseSensitive ? "g" : "gi");

const targets = [...opts.files];
const extraRoots = [];
for (const d of opts.dirs) {
  const before = targets.length;
  walk(d, opts, targets);
  if (targets.length === before) extraRoots.push(d);
}

if (opts.lines) {
  for (const f of targets) {
    const { lines } = lineCount(f);
    console.log(`${f}\t${lines}`);
  }
  process.exit(0);
}

let scannedFiles = 0;
let scannedLines = 0;
let printedLines = 0;
let matches = 0;
let hits = 0;
const report = [];

for (const file of [...new Set(targets.map((f) => resolve(f)))]) {
  let text;
  const info = lineCount(file);
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  scannedFiles++;
  scannedLines += info.lines;
  const lines = text.split(/\r?\n/);
  const marks = [];
  lines.forEach((line, idx) => {
    re.lastIndex = 0;
    if (re.test(line)) marks.push(idx);
  });
  if (!marks.length) continue;

  if (opts.count) {
    matches += marks.reduce((n, idx) => n + (lines[idx].match(re) ?? []).length, 0);
    continue;
  }

  const shown = new Set();
  const blocks = [];
  for (const idx of marks) {
    const from = Math.max(0, idx - opts.ctx);
    const to = Math.min(lines.length - 1, idx + opts.ctx);
    for (let i = from; i <= to; i++) shown.add(i);
    blocks.push({ idx, from, to });
  }
  const rel = (() => {
    const r = resolve(process.cwd());
    return file.startsWith(r) ? file.slice(r.length + 1) : file;
  })();
  report.push({ rel, lines, blocks, marks });
}

if (opts.count) {
  console.log(matches);
  process.exit(matches ? 0 : 1);
}

for (const { rel, lines, blocks, marks } of report) {
  if (hits >= opts.max) break;
  console.log(`\n${rel}  (${marks.length} совпад.)`);
  const printed = new Set();
  for (const { idx, from, to } of blocks) {
    if (hits >= opts.max) break;
    for (let i = from; i <= to && hits < opts.max; i++) {
      if (printed.has(i)) continue;
      printed.add(i);
      const isHit = marks.includes(i);
      const num = String(i + 1).padStart(5);
      const body = lines[i].trimEnd();
      console.log(`${isHit ? ">" : " "} ${num}: ${body.length > 200 ? body.slice(0, 200) + "…" : body}`);
      printedLines++;
      hits++;
    }
  }
  if (marks.length > blocks.length) console.log(`  … ещё ${marks.length - blocks.length} групп свернуто (--max)`);
}

if (!hits) {
  console.log(`Нет совпадений по /${opts.pattern}/ в ${scannedFiles} файл(ах).`);
  process.exit(1);
}

const saved = Math.max(0, scannedLines - printedLines);
const pct = scannedLines ? Math.round((saved / scannedLines) * 100) : 0;
console.log(
  `\n--- итог: /${opts.pattern}/ · файлов ${scannedFiles} (${scannedLines} строк) · ` +
  `совпадений ${report.reduce((n, r) => n + r.marks.length, 0)} · выведено ${printedLines} строк · ` +
  `сэкономлено ${saved} строк (~${pct}% объёма)`,
);
