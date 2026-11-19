import { db } from "./db";
import type { ShelfItem, SettingRow, Supplier } from "./types";

/**
 * Резервная копия: полный снимок всех таблиц в одном JSON.
 *
 * Без копии журнал живёт в IndexedDB одного устройства — удалился кэш,
 * и данных нет. Кнопка в ExportPage и честный баннер, если хранилище
 * не постоянное (`navigator.storage.persist` не дали).
 */

export interface BackupData {
  /** Версия схемы бэкапа — чтобы при восстановлении не принять мусорный JSON. */
  version: 1;
  /** Время создания копии (ISO) — показываем в интерфейсе. */
  exportedAt: string;
  items: ShelfItem[];
  settings: SettingRow[];
  suppliers: Supplier[];
}

/** Полный снимок всех таблиц. */
export async function createBackup(): Promise<BackupData> {
  const [items, settings, suppliers] = await Promise.all([
    db.items.toArray(),
    db.settings.toArray(),
    db.suppliers.toArray(),
  ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
    settings,
    suppliers,
  };
}

export interface RestoreResult {
  items: number;
  suppliers: number;
}

/**
 * Восстановление из полной копии.
 *
 * Использует bulkPut в транзакции: чистит таблицы и пишет данные из файла.
 * Это НЕ merge — восстанавливается ровно то, что в копии.
 */
export async function restoreBackup(json: string): Promise<RestoreResult> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Не удалось разобрать JSON: файл повреждён или это не копия");
  }

  const backup = data as Record<string, unknown>;
  if (backup.version !== 1) {
    throw new Error(`Неизвестный формат копии (ожидалась версия 1, получена ${String(backup.version ?? "—")})`);
  }

  const items = Array.isArray(backup.items) ? (backup.items as ShelfItem[]) : [];
  const settings = Array.isArray(backup.settings) ? (backup.settings as SettingRow[]) : [];
  const suppliers = Array.isArray(backup.suppliers) ? (backup.suppliers as Supplier[]) : [];

  if (items.length === 0 && suppliers.length === 0) {
    throw new Error("Копия пуста: в ней нет ни позиций, ни поставщиков");
  }

  return db.transaction("rw", db.items, db.settings, db.suppliers, async () => {
    await db.items.clear();
    await db.settings.clear();
    await db.suppliers.clear();

    if (items.length > 0) await db.items.bulkPut(items);
    if (settings.length > 0) await db.settings.bulkPut(settings);
    if (suppliers.length > 0) await db.suppliers.bulkPut(suppliers);

    return { items: items.length, suppliers: suppliers.length };
  });
}

/**
 * Скачать содержимое как файл — запускает загрузку в браузере.
 *
 * Принимает не только строку, но и байты: .xlsx — это zip, текстом его не
 * сохранить. Всё происходит на устройстве: Blob живёт в памяти вкладки,
 * ссылка никуда не уходит, а после клика освобождается.
 */
export function downloadFile(
  content: string | Uint8Array | Blob,
  filename: string,
  mime = "application/json",
) {
  const blob = content instanceof Blob ? content : new Blob([content as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Сгенерировать читаемое имя файла «Сроки хранения — 2026-11-17 14.30.json». */
export function backupFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return `Сроки хранения — ${date} ${time}.json`;
}