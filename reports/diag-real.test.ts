import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { parseInvoiceSheet } from "../src/domain/invoice";
import { readPdfFromData } from "../src/lib/pdf";

describe("реальный PDF: строки как их видит приложение", () => {
  it("печатает строки", async () => {
    const grids = await readPdfFromData(new Uint8Array(readFileSync("fixtures/Счет-на-оплату-реальный.pdf")));
    const result = parseInvoiceSheet(grids[0]);
    if (!result) return console.log("таблица не найдена");
    console.log("columns=" + JSON.stringify(result.columns));
    for (const row of result.rows) {
      console.log(
        "src" + row.sourceRow +
          " | №=" + JSON.stringify(row.number) +
          " | name=" + JSON.stringify(row.name.slice(0, 40)) +
          " | code=" + JSON.stringify(row.code) +
          " | qty=" + JSON.stringify(row.quantity) +
          " | unit=" + JSON.stringify(row.unit) +
          " | price=" + JSON.stringify(row.price) +
          " | amount=" + JSON.stringify(row.amount),
      );
    }
  });
});
