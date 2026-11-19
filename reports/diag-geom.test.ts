import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

/**
 * Печатает геометрию настоящего счёта: для каждой строки — левый и правый край
 * каждого куска текста. По этим числам видно, какие столбцы склеиваются.
 */

async function loadPdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

describe("геометрия PDF", () => {
  it("печатает x/right по строкам", async () => {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(readFileSync("fixtures/Счет-на-оплату-реальный.pdf"));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const placed: Array<{ x: number; y: number; right: number; text: string }> = [];
    for (const item of content.items as Array<Record<string, unknown>>) {
      if (typeof item.str !== "string") continue;
      const text = item.str.replace(/\u00a0/g, " ").trim();
      if (!text) continue;
      const t = item.transform as number[];
      const x = t[4];
      const y = viewport.height - t[5];
      const width = Math.abs(Number(item.width) || 0);
      placed.push({ x, y, right: x + width, text });
    }

    placed.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: Array<{ y: number; cells: typeof placed }> = [];
    for (const piece of placed) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(piece.y - line.y) <= 3.5) line.cells.push(piece);
      else lines.push({ y: piece.y, cells: [piece] });
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const cells = line.cells
        .sort((a, b) => a.x - b.x)
        .map((c) => {
          const numeric = /^[\d\s.,-]+$/.test(c.text);
          return (numeric ? "*" : " ") + String(Math.round(c.x)) + ".." + String(Math.round(c.right)) + " " + JSON.stringify(c.text.slice(0, 22));
        });
      console.log("r" + (i + 1) + " y=" + Math.round(line.y) + "  " + cells.join("  "));
    }

    await doc.destroy();
  });
});
