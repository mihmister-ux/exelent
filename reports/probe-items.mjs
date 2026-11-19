/** Печатает геометрию текстовых кусков PDF: x, right, y, text. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const file = process.argv[2] ?? join(here, "..", "fixtures", "invoice-2804.pdf");
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  useSystemFonts: false,
  isEvalSupported: false,
}).promise;

const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 1 });
const content = await page.getTextContent();

const rows = [];
for (const item of content.items) {
  if (typeof item.str !== "string") continue;
  const text = item.str.replace(/\u00a0/g, " ").trim();
  if (!text) continue;
  const x = item.transform[4];
  const y = viewport.height - item.transform[5];
  const right = x + Math.abs(item.width || 0);
  rows.push({ y, x, right, text });
}
rows.sort((a, b) => (Math.abs(a.y - b.y) > 3.5 ? a.y - b.y : a.x - b.x));
for (const r of rows.slice(0, 30)) {
  console.log(
    `y=${r.y.toFixed(1).padStart(7)} x=${r.x.toFixed(1).padStart(7)} r=${r.right.toFixed(1).padStart(7)}  ${r.text}`,
  );
}
await doc.destroy();
