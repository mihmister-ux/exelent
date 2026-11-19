/** Сквозная проверка: PDF → сетка → разбор накладной. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { readPdfFromData } = await import("./pdfbuild/pdf.js");
const { parseInvoice, findDocumentDate } = await import("./verify/domain/invoice.js");

const file = process.argv[2] ?? join(here, "..", "fixtures", "invoice-2804.pdf");
const grids = await readPdfFromData(new Uint8Array(readFileSync(file)));

const result = parseInvoice(grids);
if (!result) {
  console.log("parseInvoice => null");
  process.exit(1);
}
const docDate = findDocumentDate(grids.find((s) => s.name === result.sheet), result.headerRow - 1);
console.log(
  JSON.stringify(
    {
      sheet: result.sheet,
      headerRow: result.headerRow,
      supplier: result.supplier,
      documentDate: docDate,
      columns: result.columns,
      rows: result.rows.map((r) => ({
        row: r.sourceRow,
        name: r.name,
        code: r.code,
        qty: r.quantity,
        price: r.price,
        amount: r.amount,
        expiry: r.expiresAt ?? `raw:${r.rawExpires}`,
        warning: r.warning,
      })),
    },
    null,
    2,
  ),
);
