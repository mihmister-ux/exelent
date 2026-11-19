/**
 * Починка кодировки: в части файлов русский текст был записан байтами cp1251,
 * а затем прочитан как UTF-8 и сохранён заново. В результате «Сроки» превратились
 * в «РЎСЂРѕРєРё» — валидный UTF-8, но нечитаемый.
 *
 * Признак повреждения строгий: пара «Р» или «С» + символ из диапазона байтов
 * 0x80–0xBF, прочитанных как cp1251. В настоящем русском тексте такой пары
 * не бывает (после «Р» идёт обычная строчная буква, а не №, —, « или ѕ).
 *
 * Запуск:
 *   node scripts/fix-encoding.mjs          # только показать, что нашлось
 *   node scripts/fix-encoding.mjs --write  # починить
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html", ".json", ".py", ".mjs", ".webmanifest", ".md"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "dev-dist", ".git", "fixtures"]);

// Таблица cp1251 «байт → символ» и обратная к ней — из TextDecoder, без своих таблиц.
const decoder = new TextDecoder("windows-1251");
const byteToChar = new Map();
const charToByte = new Map();
for (let byte = 0; byte < 256; byte += 1) {
  const char = decoder.decode(new Uint8Array([byte]));
  byteToChar.set(byte, char);
  if (!charToByte.has(char)) charToByte.set(char, byte);
}

// Второй символ повреждённой пары: байты 0x80–0xBF, прочитанные как cp1251.
const secondChars = new Set();
for (let byte = 0x80; byte <= 0xbf; byte += 1) secondChars.add(byteToChar.get(byte));

const DAMAGE = /[\u0420\u0421]([\s\S])/g;

function damageRatio(text) {
  let pairs = 0;
  let cyrillic = 0;

  for (const char of text) {
    const code = char.codePointAt(0);
    if (code >= 0x0400 && code <= 0x04ff) cyrillic += 1;
  }
  if (cyrillic < 5) return { ratio: 0, pairs: 0 };

  for (const match of text.matchAll(DAMAGE)) {
    if (secondChars.has(match[1])) pairs += 1;
  }

  return { ratio: pairs / cyrillic, pairs };
}

/** Обратное преобразование: текст → байты cp1251 → строка UTF-8. */
function repair(text) {
  const bytes = [];
  const unmappable = new Set();

  for (const char of text) {
    const byte = charToByte.get(char);
    if (byte === undefined) {
      bytes.push(0x3f); // '?'
      unmappable.add(char);
    } else {
      bytes.push(byte);
    }
  }

  return { text: Buffer.from(bytes).toString("utf8"), unmappable: [...unmappable] };
}

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) found.push(path);
  }
  return found;
}

const rows = [];
for (const path of walk(ROOT)) {
  const text = readFileSync(path, "utf8");
  const { ratio, pairs } = damageRatio(text);
  if (ratio < 0.3) continue;

  // BOM — не потеря: в cp1251 его нет, и байты 0xEF 0xBB 0xBF просто не значатся.
  const fixed = repair(text.replace(/^\uFEFF/, ""));
  const broken = (fixed.text.match(/\uFFFD/g) ?? []).length;
  const lost = fixed.unmappable.filter((char) => char !== "\uFEFF");
  const row = {
    file: relative(ROOT, path),
    pairs,
    ratio: ratio.toFixed(2),
    status: broken > 0 ? `не чинится (${broken} битых)` : lost.length > 0 ? `потери: ${lost.join("")}` : "починено",
  };
  rows.push(row);

  if (WRITE && broken === 0 && lost.length === 0) {
    writeFileSync(path, fixed.text, "utf8");
  }
}

if (rows.length === 0) {
  console.log("повреждённых файлов нет");
} else {
  for (const row of rows) console.log(`${row.status.padEnd(24)} ${row.ratio.padStart(5)}  ${row.file}`);
  console.log(`\nвсего: ${rows.length}${WRITE ? "" : " (пробный прогон, добавьте --write)"}`);
}
