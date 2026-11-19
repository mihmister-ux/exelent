/** Прогоняет readPdfFromData (скомпилированный pdf.js) по реальному PDF и печатает сетку. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { readPdfFromData } = await import("./pdfbuild/pdf.js");

const file = process.argv[2] ?? join(here, "..", "fixtures", "invoice-2804.pdf");
const data = new Uint8Array(readFileSync(file));
const grids = await readPdfFromData(data);

for (const grid of grids) {
  console.log(`--- ${grid.name} (rows=${grid.rows.length}) scanned=${grid.looksScanned}`);
  grid.rows.forEach((row, index) => {
    const cells = row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)));
    console.log(String(index).padStart(2) + " | " + cells.join(" | "));
  });
}
