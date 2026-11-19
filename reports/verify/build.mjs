/**
 * Собирает TS-модули в обычный JS и прогоняет проверки разбора.
 *
 * Нужен потому, что vitest в песочнице агента падает на spawn EPERM (Vite
 * поднимает подпроцесс при загрузке конфига), а проверить разбор всё равно
 * надо. Здесь тот же tsc, что в проекте: он компилирует src/ в reports/verify/build,
 * дальше обычный node исполняет check.mjs и check-pdf.mjs.
 *
 * Запуск (двумя шагами, без дочерних процессов в одном вызове):
 *   node reports/verify/build.mjs          — печатает команду компиляции
 *   <команда из вывода>                    — компилирует
 *   node reports/verify/check.mjs          — проверки
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "build");

mkdirSync(out, { recursive: true });

const compiled = join(out, "domain", "invoice.js");
if (!existsSync(compiled)) {
  console.log("Сначала соберите модули:\n");
  console.log(
    `  node "${join(root, "node_modules", "typescript", "bin", "tsc")}" ` +
      `--ignoreConfig "${join(root, "src", "domain", "invoice.ts")}" ` +
      `"${join(root, "src", "lib", "dates.ts")}" ` +
      `"${join(root, "src", "lib", "xlsx.ts")}" ` +
      `--outDir "${out}" --module esnext --target es2022 ` +
      `--moduleResolution bundler --skipLibCheck\n`,
  );
  process.exit(1);
}

// Алиас "@/lib/dates" не разрешается в чистом node — подменяем на путь файла
// в каждом собранном модуле, который его импортирует.
for (const file of [join(out, "domain", "invoice.js"), join(out, "lib", "xlsx.js")]) {
  if (!existsSync(file)) continue;
  const patched = readFileSync(file, "utf8").replaceAll('"@/lib/dates"', '"../lib/dates.js"');
  writeFileSync(file, patched);
}

console.log("сборка готова: reports/verify/build");
