/**
 * Transaction-level verification of the `parseInvoice` fixes without Vitest.
 * Run with the bundled Node: <node> reports/probe-import-check.mjs
 *
 * Vitest 5 cannot start its config loader under this Windows file sandbox
 * (Vite's realpath optimization spawns a child process → EPERM), so this probe
 * asserts the same fixtures through the real modules with Node's built-in
 * `node:assert` instead. No production file is touched.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");
const fixturesDir = join(here, "..", "fixtures");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = join(srcDir, specifier.slice(2));
      const target = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((candidate) =>
        existsSync(candidate),
      );
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { parseInvoice } = await import("../src/domain/invoice.ts");
const { readWorkbook } = await import("../src/lib/xlsx.ts");

let checks = 0;
function check(label, fn) {
  fn();
  checks += 1;
  console.log(`OK  ${label}`);
}

async function gridOf(name) {
  return readWorkbook(new File([readFileSync(join(fixturesDir, name))], name));
}

/* --- пункт 10: parseNumber через разбор строки -------------------------- */
{
  const book = { name: "Numbers", rows: [
    ["Наименование", "Кол-во", "Цена", "Сумма"],
    ["Товар A", "3x2", 10, 60],
    ["Товар B", "(3)", 10, -30],
    ["Товар C", 0, 10, 0],
    ["Товар D", 2, 10, 20],
  ] };
  const result = parseInvoice([book]);
  check("n10: мусор «3x2» и qty ≤ 0 не становятся позициями", () => {
    assert.deepEqual(result?.rows.map((row) => row.name), ["Товар D"]);
    assert.deepEqual(result?.skipped, [2, 3, 4]);
  });
}

/* --- пункт 11: даты со слэшем ----------------------------------------- */
{
  const book = { name: "Dates", rows: [
    ["Наименование", "Кол-во", "Годен до", "Цена", "Сумма"],
    ["Алтей корень", 1, "11/17/27", 10, 10],
    ["Брусника лист", 1, "17/11/27", 10, 10],
    ["Валериана корень", 1, "01/02/27", 10, 10],
    ["Девясил корень", 1, "18.09..29", 10, 10],
  ] };
  const result = parseInvoice([book]);
  check("n11: 11/17/27 и 17/11/27 → 2027-11-17, 01/02/27 → 2027-02-01", () => {
    assert.deepEqual(result?.rows.slice(0, 3).map((row) => row.expiresAt),
      ["2027-11-17", "2027-11-17", "2027-02-01"]);
    assert.equal(result?.rows[3].rawExpires, "18.09..29");
    assert.match(result?.rows[3].warning ?? "", /дату срока/);
  });
}

/* --- пункты 9 и 12: алиасы и мусорные имена ---------------------------- */
{
  const book = { name: "Aliases", rows: [
    ["Позиция", "Количество", "Цена", "Сумма"],
    ["---", 2, 10, 20],
    ["Услуга", 1, 10, 10],
    ["Номенклатура", 1, 10, 10],
  ] };
  const result = parseInvoice([book]);
  check("n9: «Позиция» как заголовок, n12: «---» не позиция", () => {
    assert.equal(result?.headerRow, 1);
    assert.deepEqual(result?.rows.map((row) => row.name), ["Услуга", "Номенклатура"]);
    assert.ok(result?.skipped.includes(2), "строка «---» должна быть в skipped");
  });
}

/* --- пункт 14: скидка в проверке суммы --------------------------------- */
{
  const book = { name: "Discount", rows: [
    ["Наименование", "Кол-во", "Цена", "Скидка", "Сумма"],
    ["Со скидкой summed", 10, 100, "50", 950],
    ["Со скидкой процентом", 10, 100, "5%", 950],
    ["Без скидки", 10, 100, "", 1000],
    ["Расхождение", 10, 100, "", 900],
  ] };
  const result = parseInvoice([book]);
  check("n14: скидка суммой/процентом не даёт ложного предупреждения", () => {
    assert.deepEqual(result?.rows.slice(0, 3).map((row) => row.warning), [null, null, null]);
    assert.match(result?.rows[3].warning ?? "", /цена × кол-во/);
  });
}

/* --- реальные фикстуры ------------------------------------------------- */
{
  const names = ["Счет-2804.xlsx", "Учёт сроков хранения.xlsm", "invoice-lotos.xlsx"];
  const parsed = {};
  for (const name of names) parsed[name] = parseInvoice(await gridOf(name));

  check("фикс: Счет-2804 — поставщик без реквизитов, 16 позиций, 0 предупреждений", () => {
    const result = parsed["Счет-2804.xlsx"];
    assert.equal(result?.rows.length, 16);
    assert.match(result?.supplier, /Гален/);
    assert.doesNotMatch(result?.supplier, /ИНН|КПП/);
    assert.equal(result?.rows.filter((row) => row.warning).length, 0);
  });

  check("фикс: Учёт сроков хранения — 146 позиций на 7 листах, skipped aggregation", () => {
    const result = parsed["Учёт сроков хранения.xlsm"];
    assert.equal(result?.rows.length, 146);
    assert.equal(result?.sheets.length, 7);
    assert.equal(result?.skipped.length,
      result?.sheets.reduce((sum, part) => sum + part.skipped, 0));
  });

  check("фикс: invoice-lotos — 3 позиции, дата документа", () => {
    const result = parsed["invoice-lotos.xlsx"];
    assert.equal(result?.rows.length, 3);
    assert.equal(result?.documentDate, "2026-11-12");
  });
}

console.log(`\nВСЕГО проверок: ${checks} — зелёные`);
