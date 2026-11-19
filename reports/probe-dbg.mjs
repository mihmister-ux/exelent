/** Почему сетка PDF не разбирается: пошагово смотрим headerRow/колонки. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { readPdfFromData } = await import("./pdfbuild/pdf.js");
const domain = await import("./verify/domain/invoice.js");

const file = process.argv[2] ?? join(here, "..", "fixtures", "invoice-2804.pdf");
const grids = await readPdfFromData(new Uint8Array(readFileSync(file)));
const sheet = grids[0];

console.log("grid keys:", Object.keys(sheet));
console.log("name:", sheet.name, "rows:", sheet.rows.length);
console.log("first row:", JSON.stringify(sheet.rows[0]));
console.log("header-ish row 2:", JSON.stringify(sheet.rows[2]));
console.log("header-ish row 3:", JSON.stringify(sheet.rows[3]));

const result = domain.parseInvoiceSheet({ name: sheet.name, rows: sheet.rows });
console.log("parseInvoiceSheet =>", result ? "ok" : "null");
if (result) console.log(JSON.stringify({ headerRow: result.headerRow, columns: result.columns }, null, 2));
