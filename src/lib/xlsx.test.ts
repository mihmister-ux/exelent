/// <reference types="node" />
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXCEL_EXTENSIONS, UNREADABLE_FILE, isExcelName, readWorkbook } from "@/lib/xlsx";

/**
 * Чтение книги: .xls против .xlsx, и что видит человек на нечитаемом файле.
 *
 * Оба формата идут одним путём — SheetJS определяет формат по сигнатуре
 * (D0 CF 11 E0 у .xls, PK у .xlsx), а не по расширению. Здесь это закреплено
 * на настоящих байтах: фикстура `накладная-старый-формат.xls` — файл BIFF8,
 * сгенерированный `XLSX.write(..., {bookType: "biff8"})`.
 */

const FIXTURES = join(process.cwd(), "fixtures");
const XLS = join(FIXTURES, "накладная-старый-формат.xls");
const XLSX = join(FIXTURES, "накладная-демо.xlsx");

describe("readWorkbook", () => {
  it.skipIf(!existsSync(XLS))("читает старый .xls так же, как .xlsx", async () => {
    const bytes = readFileSync(XLS);
    // Сигнатура OLE2: это действительно старый формат, а не переименованный zip.
    expect(bytes.subarray(0, 4).toString("hex")).toBe("d0cf11e0");

    const sheets = await readWorkbook(new File([bytes], "накладная-старый-формат.xls"));

    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Лист1");
    // Шапка и таблица товаров на месте: разбор получает ту же сетку.
    expect(sheets[0].rows[0][0]).toBe("Счет на оплату N 3948 от 20.10.2026");
    expect(sheets[0].rows[4][0]).toBe("Наименование");
    expect(sheets[0].rows[5][0]).toBe("Молоко 3,2%");
  });

  it.skipIf(!existsSync(XLSX))("формат определяется по содержимому, а не по имени", async () => {
    // .xlsx, названный .xls: расширение врёт, файл читается.
    const sheets = await readWorkbook(new File([readFileSync(XLSX)], "переименованный.xls"));
    expect(sheets.length).toBeGreaterThan(0);
  });

  it("на мусоре вместо книги отдаёт понятную фразу", async () => {
    const junk = new File(["это точно не таблица"], "накладная.xls");
    await expect(readWorkbook(junk)).rejects.toThrow(UNREADABLE_FILE);
  });

  it("на пустом файле тоже не роняет разбор техническим текстом", async () => {
    await expect(readWorkbook(new File([], "пустая.xlsx"))).rejects.toThrow(UNREADABLE_FILE);
  });

  it("обрезанный .xlsx — та же фраза, а не ошибка библиотеки", async () => {
    const half = readFileSync(XLSX).subarray(0, 200);
    await expect(readWorkbook(new File([half], "обрезанный.xlsx"))).rejects.toThrow(UNREADABLE_FILE);
  });
});

describe("isExcelName", () => {
  it("пускает .xlsx, .xls, .xlsm в любом регистре", () => {
    for (const name of ["a.xlsx", "a.xls", "a.xlsm", "A.XLS", "a.XlSx"]) {
      expect(isExcelName(name)).toBe(true);
    }
  });

  it("не пускает соседние форматы и голое имя", () => {
    for (const name of ["a.csv", "a.xlsb", "a.pdf", "xls", "a.xlsx.exe"]) {
      expect(isExcelName(name)).toBe(false);
    }
  });

  it("список расширений совпадает с тем, что проверяет isExcelName", () => {
    for (const ext of EXCEL_EXTENSIONS) expect(isExcelName(`файл.${ext}`)).toBe(true);
  });
});
