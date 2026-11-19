/**
 * Ручная проверка разбора накладных — без vitest (он в песочнице агента
 * не запускается из-за spawn EPERM). Гоняет те же случаи, что и
 * src/domain/invoice.test.ts, плюс реальные фикстуры из fixtures/.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import {
  findDocumentDate,
  parseInvoice,
  parseInvoiceDate,
  parseInvoiceSheet,
  parseNumber,
} from "./build/domain/invoice.js";
import { readWorkbook } from "./build/lib/xlsx.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const results = [];

function check(label, fn) {
  try {
    const detail = fn();
    results.push({ label, ok: true, detail });
  } catch (error) {
    results.push({ label, ok: false, detail: String(error?.message ?? error) });
  }
}

function eq(actual, expected, what = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what} ожидалось ${e}, получено ${a}`);
}

const sheet = (name, rows) => ({ name, rows });

// ---------- то, что уже покрыто тестами ----------
check("parseNumber: пробелы и запятая", () => {
  eq(parseNumber("1 200,50"), 1200.5);
  eq(parseNumber("12"), 12);
  eq(parseNumber("2,5 кг"), 2.5);
  eq(parseNumber("—"), null);
});

check("parseInvoiceDate: Date и строки", () => {
  eq(parseInvoiceDate(new Date(2027, 1, 1)).iso, "2027-02-01");
  eq(parseInvoiceDate("01.02.2027").iso, "2027-02-01");
  eq(parseInvoiceDate("01.02.27").iso, "2027-02-01");
  eq(parseInvoiceDate("2026-09-18").iso, "2026-09-18");
});

check("parseInvoiceDate: битая дата в raw", () => {
  eq(parseInvoiceDate("18.09..29"), { iso: null, raw: "18.09..29" });
});

check("parseInvoiceDate: 31 февраля", () => {
  eq(parseInvoiceDate("31.02.2027").iso, null);
});

check("шапка с реквизитами не становится таблицей", () => {
  const book = sheet("Товары", [
    ["ООО «Лотос»"],
    ["ИНН 7726123456", "КПП 772601001", "123456, Москва, ул. Тверская, 1"],
    ["Поставщик: ООО Лотос"],
    ["Накладная № 451 от 12.11.2026"],
    ["№", "Наименование", "Код", "Кол-во", "Ед.", "Цена", "Сумма"],
    [1, "Конфеты шоколадные", "1001", 24, "шт", 100, 2400],
    [2, "Чабрец, 50 г", "1002", 10, "шт", 50, 500],
    ["Итого", "", "", 34, "", "", 2900],
    ["Сдал __________", "Принял __________"],
  ]);
  const result = parseInvoiceSheet(book);
  eq(result?.headerRow, 5, "headerRow");
  eq(result?.supplier, "ООО Лотос", "supplier");
  eq(result?.rows.length, 2, "rows");
  eq(result?.rows[0], {
    sourceRow: 6,
    number: "1",
    name: "Конфеты шоколадные",
    code: "1001",
    quantity: "24",
    unit: "шт",
    price: "100",
    amount: "2400",
    expiresAt: null,
    rawExpires: null,
    supplier: "ООО Лотос",
    warning: null,
  });
});

check("реквизиты без товаров => null", () => {
  const book = sheet("Лист1", [
    ["ИНН 7726123456", "КПП 772601001"],
    ["Наименование организации: ООО Ромашка"],
    ["Адрес: Москва, ул. Тверская, 1"],
  ]);
  eq(parseInvoiceSheet(book), null);
});

check("лист без таблицы пропускается", () => {
  const empty = sheet("Лист1", [["ИНН 1234567890"]]);
  const goods = sheet("Гринфито", [["Наименование", "Кол-во"], ["Трава", 3]]);
  const result = parseInvoice([empty, goods]);
  eq(result?.sheet, "Гринфито");
  eq(result?.supplier, "Гринфито");
  eq(result?.rows.length, 1);
});

// ---------- то, что тестами не покрыто ----------
check("пустые строки в середине таблицы", () => {
  const book = sheet("Накладная", [
    ["Наименование", "Кол-во"],
    ["Трава", 3],
    [null, null],
    ["Кора", 4],
  ]);
  const result = parseInvoiceSheet(book);
  eq(result?.rows.map((r) => r.name), ["Трава", "Кора"], "строки");
  eq(result?.skipped, [3], "пропущенные");
});

check("строка-группа без количества не должна стать товаром", () => {
  const book = sheet("Накладная", [
    ["Наименование", "Кол-во"],
    ["Молочная группа", null],
    ["Молоко, 1 л", 5],
  ]);
  const result = parseInvoiceSheet(book);
  eq(result?.rows.map((r) => r.name), ["Молочная группа", "Молоко, 1 л"], "строки");
});

check("число вместо текста в колонке наименования", () => {
  const book = sheet("Накладная", [
    ["Наименование", "Кол-во"],
    [12345, 3],
  ]);
  const result = parseInvoiceSheet(book);
  eq(result?.rows[0]?.name, "12345");
});

check("пустое имя без объединения не становится позицией", () => {
  const book = sheet("Накладная", [
    ["Наименование", "Код", "Кол-во"],
    [null, "1001", 3],
  ]);
  const result = parseInvoiceSheet(book);
  eq(result?.rows.length, 0, "строки");
  eq(result?.skipped, [2], "пропущенные");
});

check("parseNumber: точка как разделитель тысяч", () => {
  return { "1.200,50": parseNumber("1.200,50"), "1.234.567": parseNumber("1.234.567") };
});

check("parseInvoiceDate: год четырьмя цифрами в конце мусора", () => {
  const parsed = parseInvoiceDate("18.09.2026 г.");
  return { iso: parsed.iso, raw: parsed.raw };
});

check("parseInvoiceDate: дата с временем", () => {
  const parsed = parseInvoiceDate("18.09.2026 00:00:00");
  return { iso: parsed.iso, raw: parsed.raw };
});

check("findDocumentDate: однозначные день/месяц", () => {
  const book = sheet("Накладная", [
    ["Накладная № 7 от 3.2.2026"],
    ["Наименование", "Кол-во"],
    ["Трава", 3],
  ]);
  return { date: findDocumentDate(book, 1) };
});

// ---------- объединённые ячейки (реальный xlsx) ----------
function bookWithMerges() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Поставщик: Лотос"],
    ["Наименование", "Кол-во", "Годен до"],
    ["Чай зелёный", 24, "2027-03-01"],
    [null, 12, "2026-11-20"],
    ["Чабрец", 10, "05.12.2026"],
  ]);
  // Наименование в первой колонке объединено по вертикали (строки 3-4).
  ws["!merges"] = [{ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Накладная");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

check("объединённая по вертикали ячейка наименования", async () => {
  const buffer = bookWithMerges();
  const file = new File([buffer], "merges.xlsx");
  const sheets = await readWorkbook(file);
  const result = parseInvoice(sheets);
  return {
    rows: result?.rows.map((r) => `${r.sourceRow}:${r.name || "∅"}`),
  };
});

// ---------- реальные фикстуры ----------
async function dumpFixture(name) {
  const buffer = readFileSync(join(root, "fixtures", name));
  const file = new File([buffer], name);
  const sheets = await readWorkbook(file);
  const result = parseInvoice(sheets);
  const docDate = result ? findDocumentDate(sheets.find((s) => s.name === result.sheet), result.headerRow - 1) : null;
  return {
    sheet: result?.sheet,
    headerRow: result?.headerRow,
    supplier: result?.supplier,
    documentDate: docDate,
    rows: result?.rows.map((r) => ({
      row: r.sourceRow,
      name: r.name,
      qty: r.quantity,
      expiry: r.expiresAt ?? `raw:${r.rawExpires}`,
      supplier: r.supplier,
      warning: r.warning,
    })),
  };
}

const fixtureChecks = ["invoice-lotos.xlsx", "invoice-no-supplier.xlsx", "накладная-демо.xlsx"].map(
  (name) => ({ label: `фикстура ${name}`, ok: true, detail: dumpFixture(name) }),
);

// check() синхронный, поэтому промисы ждём отдельно
const report = [];
for (const entry of results) {
  if (entry.detail && typeof entry.detail.then === "function") {
    entry.detail = await entry.detail;
  }
  report.push(entry);
}
for (const entry of fixtureChecks) {
  try {
    report.push({ ...entry, detail: await entry.detail });
  } catch (error) {
    report.push({ ...entry, ok: false, detail: String(error?.message ?? error) });
  }
}

let failed = 0;
for (const entry of report) {
  if (entry.ok) {
    console.log(`OK   ${entry.label}`);
    if (entry.detail !== undefined) console.log("     " + JSON.stringify(entry.detail));
  } else {
    failed += 1;
    console.log(`FAIL ${entry.label}`);
    console.log("     " + entry.detail);
  }
}
console.log(`\nвсего ${report.length}, провалено ${failed}`);
