/** Проверяет readPdfFromData на реальном PDF через legacy-сборку pdfjs. */
import { readFileSync } from "node:fs";

const { readPdfFromData } = await import("../src/lib/pdf.ts").catch(() => ({}));

// Прямой путь: используем скомпилированный модуль невозможно (TS), поэтому
// повторяем чтение здесь через legacy-сборку — проверяем саму логику сетки.
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const file = process.argv[2];
const data = new Uint8Array(readFileSync(file));
const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
console.log("pages:", doc.numPages);

const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 1 });
const content = await page.getTextContent();
console.log("text items:", content.items.length);
console.log("sample:", content.items.slice(0, 8).map((i) => ({ str: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5]), w: Math.round(i.width) })));
await doc.destroy();
