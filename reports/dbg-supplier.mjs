/** Черновая отладка поставщика на Счет-2804.xlsx: показывает строки сетки
 * вокруг шапки и то, что parseInvoiceSheet вернул поставщиком. */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = join(srcDir, specifier.slice(2));
      const target = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((c) => existsSync(c));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { parseInvoiceSheet } = await import("../src/domain/invoice.ts");
const { readWorkbook } = await import("../src/lib/xlsx.ts");

const path = join(here, "..", "fixtures", process.argv[2] ?? "Счет-2804.xlsx");
const sheets = await readWorkbook(new File([readFileSync(path)], "x.xlsx"));
const grid = sheets[0];
for (const index of [3, 4, 8, 12, 15, 21, 22]) {
  console.log(`строка ${index + 1}:`, JSON.stringify(grid.rows[index]?.map((v) => (v === null ? null : String(v)))));
}
const result = parseInvoiceSheet(grid);
console.log("headerRow:", result?.headerRow);
console.log("supplier:", JSON.stringify(result?.supplier));
console.log("columns:", result?.columns);
