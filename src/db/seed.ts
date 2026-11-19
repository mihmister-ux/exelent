import { db } from "./db";
import { defaultSuppliers } from "@/domain/suppliers";

/**
 * Первый запуск: переносим в браузерную базу 146 строк, разобранных на этапе 1
 * из `Учёт сроков хранения.xlsm` (контрольные суммы — reports/import-report.md).
 *
 * Инициализация должна быть идемпотентной. В dev-режиме React StrictMode
 * вызывает эффект дважды, поэтому без защиты получалось два параллельных
 * импорта: первый вставлял строки, второй падал с `ConstraintError:
 * Key already exists in the object store`. Отсюда три уровня защиты:
 *   1) single-flight — параллельные вызовы получают одно и то же обещание;
 *   2) вся работа внутри одной транзакции — флаг ставится там же, где данные;
 *   3) bulkPut вместо bulkAdd — повторная запись не падает, а обновляет.
 */

export const SEED_KEY = "seed:v1";
export const SEED_VERSION = 1;
/** Отдельный флаг справочника: добавлен позже, поэтому его сеем независимо. */
export const SUPPLIERS_SEED_KEY = "seed:suppliers:v1";

/**
 * Демо-журнал и справочник первого запуска живут только в разработке.
 *
 * Публичная сборка на GitHub Pages должна открываться с пустым журналом:
 * строки из книги Excel — это данные конкретного склада, а не пример для
 * всех. Флаг `import.meta.env.DEV` в прод-сборке подставляется как `false`,
 * поэтому ветка вырезается сборщиком целиком — вместе с динамическим
 * импортом `seed-shelf.json` (48 КБ демо-данных в бандл не попадают).
 *
 * Демо-механизм не удалён: `npm run dev` работает как раньше.
 */
export const SEED_ENABLED = import.meta.env.DEV;

export interface SeedResult {
  inserted: number;
  alreadySeeded: boolean;
}

let inFlight: Promise<SeedResult> | null = null;

/** Заполняет пустую базу. Уже наполненную не трогает — это живые данные склада. */
export function ensureSeeded(): Promise<SeedResult> {
  if (!SEED_ENABLED) {
    // Публичная сборка: база остаётся пустой, журнал начинается с нуля.
    return Promise.resolve({ inserted: 0, alreadySeeded: false });
  }

  inFlight ??= seedOnce().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function seedOnce(): Promise<SeedResult> {
  // Динамический импорт, а не статический: демо-JSON не должен попадать
  // в публичный бандл. Загружаем до открытия транзакции — Dexie закрывает
  // транзакцию, если внутри неё ждать что-то помимо своих операций.
  const { seedItems } = await import("@/data/seedItems");
  const items = seedItems();

  return db.transaction("rw", db.items, db.settings, db.suppliers, async () => {
    const flag = await db.settings.get(SEED_KEY);
    if (flag) {
      // Флаг уже стоит, но справочник мог появиться после него (обновление) —
      // дозаполняем отдельно, не трогая живые позиции.
      await seedSuppliersOnce();
      return { inserted: 0, alreadySeeded: true };
    }

    const existing = await db.items.count();
    let inserted = 0;

    if (existing === 0) {
      await db.items.bulkPut(items);
      inserted = items.length;
    }

    await db.settings.put({ id: SEED_KEY, value: String(SEED_VERSION) });
    await seedSuppliersOnce();
    return { inserted, alreadySeeded: false };
  });
}

/** Справочник поставщиков: заполняем один раз, на уже живую базу не давим. */
async function seedSuppliersOnce(): Promise<void> {
  const flag = await db.settings.get(SUPPLIERS_SEED_KEY);
  if (flag) return;

  // Сохраняем то, что человек уже вписал вручную; дополняем только недостающим.
  const existing = new Map((await db.suppliers.toArray()).map((s) => [s.id, s]));
  for (const supplier of defaultSuppliers()) {
    if (!existing.has(supplier.id)) existing.set(supplier.id, supplier);
  }
  if (existing.size > 0) await db.suppliers.bulkPut([...existing.values()]);

  await db.settings.put({ id: SUPPLIERS_SEED_KEY, value: "1" });
}

/** Повторный импорт из JSON — если журнал пересобрали на этапе 1. */
export async function reseedFromJson(): Promise<number> {
  // Ручное перечитывание заливает те же демо-строки, поэтому тоже только в dev.
  if (!SEED_ENABLED) {
    throw new Error("Перечитывание демо-журнала доступно только в режиме разработки");
  }

  const { seedItems } = await import("@/data/seedItems");
  const items = seedItems();

  await db.transaction("rw", db.items, db.settings, async () => {
    // `source` не входит в индексы, поэтому отбираем в памяти: записей немного.
    const existing = await db.items.toArray();
    const keep = existing.filter((item) => item.source !== "import");

    await db.items.clear();
    await db.items.bulkPut(items);
    // Ручные позиции и строки из накладных не теряем при переимпорте.
    if (keep.length > 0) await db.items.bulkPut(keep);
    await db.settings.put({ id: SEED_KEY, value: String(SEED_VERSION) });
  });

  return items.length;
}
