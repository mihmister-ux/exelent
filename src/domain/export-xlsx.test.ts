import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import type { ShelfItem, Supplier } from "@/db/types";
import {
  JOURNAL_HEADERS,
  itemRow,
  journalFilename,
  journalWorkbook,
  sheetName,
  workbookBytes,
} from "@/domain/export-xlsx";

function item(part: Partial<ShelfItem> & Pick<ShelfItem, "id" | "name" | "supplier">): ShelfItem {
  return {
    receivedAt: null,
    expiresAt: "2027-01-01",
    marked: false,
    status: "in_stock",
    soldAt: null,
    writtenOffAt: null,
    note: null,
    ...part,
  };
}

const ON = new Date(2026, 10, 17); // 17.11.2026 — «сегодня» для теста

const SUPPLIERS: Supplier[] = [
  { id: "s1", name: "Гринфито", color: "#15803d", aliases: ["ГРИНФИТО ООО"], hidden: false, order: 10 },
  { id: "s2", name: "Две Линии", color: "#1d4ed8", aliases: [], hidden: false, order: 20 },
];

function readBack(book: XLSX.WorkBook) {
  const bytes = workbookBytes(book);
  return XLSX.read(bytes, { type: "array", cellDates: true });
}

function cells(sheet: XLSX.WorkSheet, address: string) {
  return sheet[address];
}

describe("журнал в .xlsx", () => {
  it("девять колонок ровно в согласованном порядке", () => {
    expect(JOURNAL_HEADERS).toHaveLength(9);
    expect(JOURNAL_HEADERS[0]).toBe("п/н");
    expect(JOURNAL_HEADERS[8]).toBe("Дата акта на списании");
  });

  it("отдельный лист на каждого поставщика", () => {
    const book = journalWorkbook(
      [
        item({ id: "1", name: "A", supplier: "Гринфито" }),
        item({ id: "2", name: "B", supplier: "Две Линии" }),
        item({ id: "3", name: "C", supplier: "Две Линии" }),
      ],
      { on: ON, suppliers: SUPPLIERS },
    );

    expect(book.SheetNames).toEqual(["Гринфито", "Две Линии"]);
    expect(book.Sheets["Две Линии"]["!ref"]).toBe("A1:I3");
  });

  it("сырое написание из Excel попадает на лист справочника", () => {
    const book = journalWorkbook(
      [item({ id: "1", name: "A", supplier: "ГРИНФИТО ООО" })],
      { on: ON, suppliers: SUPPLIERS },
    );

    expect(book.SheetNames).toEqual(["Гринфито"]);
  });

  it("выбывший товар: «Выбыл» = продан, F пустая", () => {
    const row = itemRow(
      item({ id: "1", name: "A", supplier: "X", status: "sold", expiresAt: "2020-01-01" }),
      0,
      ON,
    );

    expect(row[0]).toBe(1);
    expect(row[5]).toBe(""); // F — истёк срок, у проданного не считаем
    expect(row[6]).toBe("продан"); // G
  });

  it("просроченный товар в наличии помечается в F", () => {
    const row = itemRow(item({ id: "1", name: "A", supplier: "X", expiresAt: "2020-01-01" }), 0, ON);
    expect(row[5]).toBe("Просрочен");
  });

  it("даты в файле — настоящие даты, а не текст", () => {
    const book = journalWorkbook(
      [item({ id: "1", name: "A", supplier: "Гринфито", receivedAt: "2026-10-07", expiresAt: "2027-11-06" })],
      { on: ON, suppliers: SUPPLIERS },
    );

    const read = readBack(book);
    const sheet = read.Sheets["Гринфито"];
    expect(cells(sheet, "C2").t).toBe("d");
    expect(cells(sheet, "D2").t).toBe("d");
    expect((cells(sheet, "D2").v as Date).getDate()).toBe(6);
    expect((cells(sheet, "D2").v as Date).getMonth()).toBe(10);
  });

  it("нераспознанная дата из источника сохраняется текстом", () => {
    const row = itemRow(
      item({ id: "1", name: "A", supplier: "X", expiresAt: null, rawExpires: "18.09..29" }),
      0,
      ON,
    );
    expect(row[3]).toEqual({ v: "18.09..29" });
  });

  it("порядок строк — по номеру строки исходного журнала", () => {
    const book = journalWorkbook(
      [
        item({ id: "b", name: "Вторая", supplier: "Гринфито", excelRow: 20 }),
        item({ id: "a", name: "Первая", supplier: "Гринфито", excelRow: 12 }),
      ],
      { on: ON, suppliers: SUPPLIERS },
    );

    const read = readBack(book);
    const sheet = read.Sheets["Гринфито"];
    expect(cells(sheet, "B2").v).toBe("Первая");
    expect(cells(sheet, "B3").v).toBe("Вторая");
  });

  it("имя листа укладывается в 31 символ и не дублируется", () => {
    const taken = new Set<string>();
    const long = "ЛБренд Кавказский травник (ист1) и ещё немного букв";
    expect(sheetName(long, taken).length).toBeLessThanOrEqual(31);

    const again = sheetName(long, taken);
    expect(again).not.toBe(sheetName(long, new Set()));
    expect(taken.size).toBe(2);
  });

  it("пустой журнал не даёт битую книгу", () => {
    const book = journalWorkbook([], { on: ON });
    expect(book.SheetNames).toHaveLength(1);
    expect(book.Sheets[book.SheetNames[0]]["!ref"]).toBe("A1:I1");
  });

  it("имя файла — .xlsx с датой", () => {
    expect(journalFilename(new Date(2026, 10, 17, 14, 30))).toBe("Сроки хранения — 2026-11-17 14.30.xlsx");
  });
});
