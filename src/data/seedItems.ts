/**
 * Разбор JSON, полученного на этапе 1 из `Учёт сроков хранения.xlsm`
 * (см. `data/shelf-data.json` и `reports/import-report.md`).
 *
 * Модуль намеренно не тянет Dexie: это чистое преобразование данных,
 * которое можно проверять тестами без браузера.
 */

import type { ShelfItem, ShelfStatus } from "@/db/types";
import seedRaw from "@/data/seed-shelf.json";

export interface RawSeedItem {
  id: string;
  name: string;
  supplier: string;
  receivedAt: string | null;
  expiresAt: string | null;
  marked: boolean;
  status: string;
  soldAt: string | null;
  note: string | null;
}

const RAW_EXPIRES_PREFIX = "expires_raw=";

/** «Алфит!D25 = '18.09..29'» — дату не распознали, но исходный текст терять нельзя. */
export function extractRawExpires(note: string | null): string | null {
  if (!note || !note.startsWith(RAW_EXPIRES_PREFIX)) return null;
  const value = note.slice(RAW_EXPIRES_PREFIX.length).trim();
  return value.replace(/^['"]|['"]$/g, "");
}

/** id вида `s03r017` → строка 17 исходного журнала (нужна выгрузке 1:1). */
export function parseExcelRow(id: string): number | null {
  const match = /r(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

function normalizeStatus(status: string): ShelfStatus {
  if (status === "sold" || status === "written_off") return status;
  return "in_stock";
}

/** 146 позиций журнала в схеме приложения. */
export function seedItems(): ShelfItem[] {
  return (seedRaw as RawSeedItem[]).map((raw) => {
    const rawExpires = extractRawExpires(raw.note);
    return {
      id: raw.id,
      name: raw.name,
      supplier: raw.supplier,
      receivedAt: raw.receivedAt,
      // Текст вместо даты оставляем пустым сроком: строка уходит в «Без срока»,
      // а исходное значение показываем в диалоге «Изменить» (кнопка «Изменить»).
      expiresAt: rawExpires ? null : raw.expiresAt,
      marked: raw.marked,
      status: normalizeStatus(raw.status),
      soldAt: raw.soldAt,
      writtenOffAt: null,
      note: rawExpires ? null : raw.note,
      rawExpires,
      source: "import",
      excelSheet: raw.supplier,
      excelRow: parseExcelRow(raw.id),
    };
  });
}
