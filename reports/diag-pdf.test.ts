import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { parseInvoiceSheet } from "../src/domain/invoice";
import { readPdfFromData } from "../src/lib/pdf";

/**
 * Диагностика PDF-пути: та же накладная, но сетка строится из координат
 * текста. Здесь видно, путает ли алгоритм колонки «Код», «Кол-во», «Цена».
 */

describe("PDF №2804", () => {
  it("показывает, что видит разборщик", async () => {
    const data = new Uint8Array(readFileSync("fixtures/invoice-2804.pdf"));
    const grids = await readPdfFromData(data);

    for (const grid of grids) {
      console.log("=== " + grid.name + " (rows=" + grid.rows.length + ") ===");
      for (let i = 0; i < grid.rows.length; i += 1) {
        const cells = grid.rows[i]
          .map((cell, index) => (cell === null || cell === undefined || String(cell).trim() === "" ? null : index + ":" + String(cell).slice(0, 34)))
          .filter(Boolean);
        console.log("  r" + (i + 1) + " " + cells.join(" | "));
      }

      const result = parseInvoiceSheet(grid);
      console.log("");
      console.log("headerRow =", result?.headerRow);
      console.log("columns =", JSON.stringify(result?.columns));
      console.log("rows =", result?.rows.length);
      console.log("skipped =", JSON.stringify(result?.skipped));
      for (const row of result?.rows ?? []) {
        console.log(
          "   #" + row.number +
            " | code=" + JSON.stringify(row.code) +
            " | qty=" + JSON.stringify(row.quantity) +
            " | unit=" + JSON.stringify(row.unit) +
            " | price=" + JSON.stringify(row.price) +
            " | amount=" + JSON.stringify(row.amount) +
            " | name=" + JSON.stringify(row.name.slice(0, 40)),
        );
      }
    }
  });
});
