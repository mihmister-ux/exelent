/**
 * Сквозной прогон импорта по реальным фикстурам: fixtures/*.xlsx|*.xlsm → разбор
 * накладной. Печатает по файлу: сколько строк разобрано, сколько пропущено,
 * какие позиции получились (лист, строка файла, наименование, кол-во, срок).
 *
 * Зачем отдельный скрипт, а не тест: тесты проверяют правила на выдуманных
 * сетках, а здесь видно, что правила делают с настоящими счетами санатория —
 * «было/стало» по числу потерянных строк. Библиотека xlsx берётся та же, что
 * в браузере (src/lib/xlsx.ts), поэтому сетка значений ровно та, что увидит
 * приложение.
 *
 * Запуск: <node> reports/probe-import-final.mjs [--brief]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");
const fixturesDir = join(here, "..", "fixtures");

/**
 * Node исполняет .ts сам (type stripping), но не знает про alias «@/» из
 * tsconfig — без этого хука `import ... from "@/lib/dates"` внутри
 * domain/invoice.ts не разрешается.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      // В tsconfig alias указывает на «./src/*», а импорты идут без расширения
      // («@/lib/dates») — Node же расширения не подбирает, подбираем сами.
      const base = join(srcDir, specifier.slice(2));
      const target = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((candidate) =>
        existsSync(candidate),
      );
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { parseInvoice } = await import("../src/domain/invoice.ts");
const { readWorkbook } = await import("../src/lib/xlsx.ts");

const brief = process.argv.includes("--brief");

/** Один файл книги: та же сетка, что в приложении (readWorkbook). */
async function gridOf(path, name) {
  const bytes = readFileSync(path);
  // File — глобальный класс Node 20+: readWorkbook ждёт именно File с
  // arrayBuffer(), поэтому браузерный путь чтения не приходится дублировать.
  return readWorkbook(new File([bytes], name));
}

function describe(row) {
  const qty = row.quantity ? ` ×${row.quantity}${row.unit ? ` ${row.unit}` : ""}` : "";
  const expiry = row.expiresAt ?? (row.rawExpires ? `?«${row.rawExpires}»` : "—");
  const warn = row.warning ? `  ⚠ ${row.warning}` : "";
  return `      ${row.sheet}:${row.sourceRow}  ${row.name}${qty}  срок=${expiry}${warn}`;
}

const files = readdirSync(fixturesDir)
  .filter((name) => /\.(xlsx|xlsm)$/i.test(name))
  .sort((a, b) => a.localeCompare(b, "ru"));

let totalRows = 0;
let totalSkipped = 0;

for (const name of files) {
  const path = join(fixturesDir, name);
  console.log(`\n=== ${name} ===`);
  try {
    const sheets = await gridOf(path, name);
    const result = parseInvoice(sheets);

    if (!result) {
      console.log("  таблицу товаров не нашли (0 строк)");
      console.log(`  листов в книге: ${sheets.length}`);
      continue;
    }

    const skipped = result.sheets.reduce((sum, part) => sum + part.skipped, 0);
    totalRows += result.rows.length;
    totalSkipped += skipped;

    console.log(
      `  разобрано: ${result.rows.length}   пропущено: ${skipped}   ` +
        `уверенность: ${result.confidence.toFixed(2)}   поставщик: ${result.supplier || "—"}` +
        `${result.documentDate ? `   дата документа: ${result.documentDate}` : ""}`,
    );
    console.log(
      `  листы с таблицей: ${result.sheets
        .map((part) => `«${part.sheet}» ${part.rowCount}${part.continuation ? " (продолжение)" : ""}`)
        .join(" · ")}`,
    );
    if (!brief) {
      for (const row of result.rows) console.log(describe(row));
    } else {
      console.log(`      позиции: ${result.rows.map((row) => row.name).join(" | ")}`);
    }
  } catch (error) {
    console.log(`  ОШИБКА чтения/разбора: ${String(error)}`);
  }
}

console.log(`\nИТОГО по ${files.length} книгам: разобрано ${totalRows}, пропущено ${totalSkipped}`);
