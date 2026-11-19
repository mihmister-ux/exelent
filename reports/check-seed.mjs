/**
 * Сверка seed-данных с отчётом импорта: сколько строк и сколько выбывших
 * по каждому поставщику. Нужна, чтобы отличить ошибку данных от устаревшего
 * ожидания в тесте. Не входит в проверку, только разведка.
 */
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync(new URL("../data/shelf-data.json", import.meta.url), "utf8"));
console.log(`всего строк: ${raw.length}`);

const byStatus = {};
const bySupplier = new Map();
for (const item of raw) {
  byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
  const row = bySupplier.get(item.supplier) ?? { total: 0, sold: 0, written_off: 0 };
  row.total += 1;
  if (item.status === "sold") row.sold += 1;
  if (item.status === "written_off") row.written_off += 1;
  bySupplier.set(item.supplier, row);
}

console.log("по статусам:", byStatus);
console.log("поставщик | строк | продано | списано");
for (const [name, row] of bySupplier) {
  console.log(`${name} | ${row.total} | ${row.sold} | ${row.written_off}`);
}

// Строки с истёкшим сроком на снимок 2026-11-12 — здесь важно, выбывшая ли она.
const TODAY = new Date(2026, 10, 12);
for (const item of raw) {
  if (!item.expiresAt) continue;
  const days = Math.round((new Date(`${item.expiresAt}T00:00:00`) - TODAY) / 86_400_000);
  if (days <= 60) {
    console.log(`срок ${item.expiresAt} (${days} дн.) | ${item.status} | ${item.supplier} | ${item.name.slice(0, 40)}`);
  }
}
