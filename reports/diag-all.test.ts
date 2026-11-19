import { readdirSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { describe, it } from "vitest";

import { parseInvoiceSheet } from "../src/domain/invoice";
import { readPdfFromData } from "../src/lib/pdf";
import type { SheetGrid } from "../src/lib/xlsx";

/** Читает книгу так же, как lib/xlsx.ts — чтобы диагностика не расходилась с приложением. */
function readGrid(buffer: Buffer): SheetGrid[] {
  const book = XLSX.read(buffer, { type: "buffer", cellDates: true, cellNF: false, cellText: true });
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: true,
    });
    const merges = sheet["!merges"] as XLSX.Range[] | undefined;
    if (merges?.length) {
      for (const range of merges) {
        const source = rows[range.s.r]?.[range.s.c];
        if (source === null || source === undefined || String(source).trim() === "") continue;
        for (let r = range.s.r; r <= range.e.r; r += 1) {
          const row = rows[r];
          if (!row) continue;
          for (let c = range.s.c; c <= range.e.c; c += 1) {
            const value = row[c];
            if (value === null || value === undefined || String(value).trim() === "") row[c] = source;
          }
        }
      }
    }
    return { name, rows };
  });
}

function report(label: string, grid: SheetGrid): void {
  const result = parseInvoiceSheet(grid);
  console.log("--- " + label + " ---");
  if (!result) {
    console.log("   таблица не найдена");
    return;
  }
  console.log("   headerRow=" + result.headerRow + " columns=" + JSON.stringify(result.columns));
  console.log("   rows=" + result.rows.length + " skipped=" + JSON.stringify(result.skipped));
  for (const row of result.rows) {
    const fields: Array<[string, string]> = [
      ["number", row.number],
      ["name", row.name],
      ["code", row.code],
      ["quantity", row.quantity],
      ["unit", row.unit],
      ["price", row.price],
      ["amount", row.amount],
    ];
    const strays = fields.filter(([, value]) => value.trim() === "2").map(([key]) => key);
    console.log(
      "   src" + row.sourceRow +
        " name=" + JSON.stringify(row.name.slice(0, 32)) +
        " code=" + JSON.stringify(row.code) +
        " qty=" + JSON.stringify(row.quantity) +
        " price=" + JSON.stringify(row.price) +
        " amount=" + JSON.stringify(row.amount) +
        (strays.length ? "   <<< ДВОЙКА В: " + strays.join(", ") : ""),
    );
  }
}

describe("все фикстуры: где живёт «2»", () => {
  it("разбирает каждый файл", async () => {
    for (const file of readdirSync("fixtures").sort()) {
      if (/\.(xlsx|xlsm)$/i.test(file)) {
        for (const grid of readGrid(readFileSync("fixtures/" + file))) {
          report(file + " / " + grid.name, grid);
        }
      }
      if (/\.pdf$/i.test(file)) {
        const grids = await readPdfFromData(new Uint8Array(readFileSync("fixtures/" + file)));
        for (const grid of grids) {
          console.log("--- " + file + " GRID ---");
          for (let i = 0; i < grid.rows.length; i += 1) {
            const cells = grid.rows[i]
              .map((cell, index) => (cell === null || cell === undefined || String(cell).trim() === "" ? null : index + ":" + String(cell).slice(0, 30)))
              .filter(Boolean);
            console.log("   r" + (i + 1) + " " + cells.join(" | "));
          }
          report(file + " / " + grid.name, grid);
        }
      }
    }
  });
});
