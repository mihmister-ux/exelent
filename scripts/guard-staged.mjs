#!/usr/bin/env node
/**
 * guard-staged.mjs — защита от мусора в индексе (pre-commit).
 *
 * Блокирует коммит, если в индексе есть запрещённые файлы или файл > 10 МБ.
 * Читает только имена и размеры через git — содержимое файлов в чат не попадает.
 *
 * Важно: запускаем git через spawnSync с выводом в файл, а не через pipe.
 * В песочнице Windows pipe при spawn блокируется, файловый дескриптор — нет.
 *
 * Выход: 0 — чисто, 1 — коммит заблокирован.
 */
import { spawnSync } from "node:child_process";
import { openSync, closeSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 10 * 1024 * 1024;
let seq = 0;

function git(args) {
  const dir = join(process.cwd(), ".dsh");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `guard-out-${process.pid}-${seq++}.txt`);
  const fd = openSync(file, "w+");
  let res;
  try {
    res = spawnSync("git", args, { stdio: ["ignore", fd, fd] });
  } finally {
    closeSync(fd);
  }
  const out = readFileSync(file, "utf8");
  rmSync(file, { force: true });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`git ${args[0]} завершился с кодом ${res.status}: ${out.trim()}`);
  return out;
}

function staged() {
  // -z: имена через NUL — корректно для пробелов и кириллицы.
  // --diff-filter=ACMR: удалённые файлы не проверяем.
  return git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    .split("\0")
    .filter(Boolean);
}

function sizeOf(file) {
  try {
    // :0 — версия файла в индексе, а не на диске.
    return Number(git(["cat-file", "-s", `:0:${file}`]).trim());
  } catch {
    return null; // объект ещё не записан — размер неизвестен
  }
}

function violation(file) {
  const p = file.replace(/\\/g, "/");
  const base = p.split("/").pop();
  if (p.endsWith(".bak")) return "файл .bak (бэкап)";
  if (/^\.env($|\.)/.test(base) && base !== ".env.example") return "секреты .env";
  if (p.startsWith("dist/") || p.includes("/dist/")) return "папка dist/";
  if (p.startsWith("node_modules/") || p.includes("/node_modules/")) return "папка node_modules/";
  if (p.startsWith("reports/video/") || p.includes("/reports/video/")) return "тяжёлые файлы reports/video/";
  const size = sizeOf(file);
  if (size !== null && size > MAX_BYTES) {
    return `файл больше 10 МБ (${(size / 1024 / 1024).toFixed(1)} МБ)`;
  }
  return null;
}

let files;
try {
  files = staged();
} catch (e) {
  console.error("guard-staged: не удалось прочитать индекс git —", e.message);
  process.exit(1);
}
if (!files.length) process.exit(0);

const blocked = [];
for (const f of files) {
  const why = violation(f);
  if (why) blocked.push({ f, why });
}

if (blocked.length) {
  console.error("\nКоммит заблокирован: найден файл в индексе:");
  for (const { f, why } of blocked) {
    console.error(`   • ${f} — ${why}`);
  }
  console.error("\nУбери его из индекса (git rm --cached X) или добавь в .gitignore.");
  console.error("Если файл нужен в проекте — переименуй и повтори git add.\n");
  process.exit(1);
}

const big = files.filter((f) => {
  const s = sizeOf(f);
  return s !== null && s > 7 * 1024 * 1024;
});
if (big.length) {
  console.warn(`⚠️ Внимание: файлы ближе к лимиту 10 МБ: ${big.join(", ")}`);
}

console.log(`guard-staged: проверено ${files.length} файл(ов) — мусора нет.`);
