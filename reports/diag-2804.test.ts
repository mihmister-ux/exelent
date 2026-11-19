import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { describe, it } from "vitest";

import { parseInvoiceSheet } from "../src/domain/invoice";
import type { SheetGrid } from "../src/lib/xlsx";

/**
 * Диагностика настоящей накладной №2804: читаем тот же файл, что и приложение,
 * ровно тем же способом (lib/xlsx.ts), и смотрим, что видит разборщик.
 */

function readGrid(file: string): SheetGrid[] {
  const buffer = readFileSync(file);
  const book = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellNF: false,
    cellText: true,
  });

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
            if (value === null || value === undefined || String(value).trim() === "") {
              row[c] = source;
            }
          }
        }
      }
    }

    return { name, rows };
  });
}

describe("накладная №2804", () => {
  it("показывает, что видит разборщик", () => {
    const sheets = readGrid("fixtures/Счет-2804.xlsx");
    const result = parseInvoiceSheet(sheets[0]);

    console.log("headerRow =", result?.headerRow);
    console.log("columns =", JSON.stringify(result?.columns));
    console.log("supplier =", JSON.stringify(result?.supplier));
    console.log("rows =", result?.rows.length);
    console.log("skipped =", JSON.stringify(result?.skipped));
    console.log("");
    for (const row of result?.rows ?? []) {
      console.log(
        `  #${row.number} | name=${JSON.stringify(row.name.slice(0, 45))} | code=${JSON.stringify(row.code)} | qty=${JSON.stringify(row.quantity)} | unit=${JSON.stringify(row.unit)} | price=${JSON.stringify(row.price)} | amount=${JSON.stringify(row.amount)} | warn=${JSON.stringify(row.warning)}`,
      );
    }
  });
});
