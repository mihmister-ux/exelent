import { db } from "./db";
import { planSupplierLinks } from "./supplier-links";
import { isInStock, type ShelfItem, type ShelfItemDraft } from "./types";
import { toISODate } from "@/lib/dates";
import { cleanSupplierName } from "@/domain/supplier-name";

/**
 * Изменения журнала. Каждое действие — одна транзакция и один штамп updatedAt.
 *
 * Правило «Выбыл» из источника: значение в колонке G («продан») переводило
 * строку в разряд выбывших, но саму строку не удаляло. Здесь так же:
 * позиция остаётся в базе и уходит из «Сроков» в «Архив».
 */

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Черновик с очищенным поставщиком.
 *
 * Одна точка на все пути записи (рука, накладная, правка): в базе не должно
 * оказаться «ООО "ПКФ "ДВЕ ЛИНИИ"», иначе один поставщик снова расползётся по
 * вкладкам и фильтрам. Пустой после чистки поставщик оставляем как был — иначе
 * позиция потеряет привязку совсем.
 */
function withCleanSupplier<T extends { supplier: string }>(draft: T): T {
  const cleaned = cleanSupplierName(draft.supplier);
  return cleaned && cleaned !== draft.supplier ? { ...draft, supplier: cleaned } : draft;
}

/** Новый id позиции: время + случайный хвост. */
function newId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Нормализация позиции в ключ для поиска дублей.
 *
 * Ключ = поставщик + название + срок годности + дата поступления.
 *
 * Срок и дата поступления в ключе по одной причине: партия — это не только
 * «что и от кого», но и «когда привезли». Один и тот же товар с тем же сроком,
 * принятый в разные дни, — две поставки, и кладовщик должен видеть их
 * раздельно; раньше вторая молча схлопывалась в первую, и в журнале оставалась
 * одна дата поступления на две приёмки.
 *
 * Без срока/даты (null или пусто) значение нормализуется в пустую строку: две
 * бессрочные позиции одного товара, принятые в один день, по-прежнему дубль.
 *
 * Название: регистр, лишние пробелы, «ё» → «е».
 */
function norm(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function nameKey(
  item: Pick<ShelfItem, "name" | "supplier" | "expiresAt" | "receivedAt">,
): string {
  // Каждое поле нормализуем отдельно — иначе пробелы «прилипают» к разделителю
  // и два одинаковых по смыслу значения дают разные ключи.
  const supplierKey = norm(item.supplier ?? "");
  const itemNameKey = norm(item.name ?? "");

  // expiresAt и receivedAt — ISO-даты YYYY-MM-DD. null или пустая строка → пусто.
  const expiryKey = (item.expiresAt ?? "").trim();
  const receivedKey = (item.receivedAt ?? "").trim();

  return `${supplierKey}\u0000${itemNameKey}\u0000${expiryKey}\u0000${receivedKey}`;
}

/**
 * Разрешает привязку позиций к справочнику и дописывает новые записи
 * поставщиков. Вызывается внутри транзакции, в которую уже включена таблица
 * suppliers: иначе ручной выбор существующего поставщика не проставлял бы id,
 * а новый — не заводил бы запись справочника.
 */
async function applySupplierLinks(items: ShelfItem[], stamp: string): Promise<ShelfItem[]> {
  const suppliers = await db.suppliers.toArray();
  const plan = planSupplierLinks(items, suppliers, stamp);
  if (plan.newSuppliers.length > 0) await db.suppliers.bulkPut(plan.newSuppliers);
  return plan.items;
}

/**
 * Ручное добавление одной позиции.
 *
 * Возвращает id новой записи или `null`, если такая позиция этого поставщика
 * с таким же сроком и той же датой поступления уже есть в наличии. Раньше
 * проверки не было вообще: дубль, заведённый руками, потом молча проходил и при
 * импорте накладной — ровно та дыра, ради которой ключ включил срок годности
 * и дату поступления.
 *
 * Проданные и списанные позиции не считаются дублем: повторная закупка
 * того же товара — законная новая партия.
 */
export async function addItem(rawDraft: ShelfItemDraft): Promise<string | null> {
  const draft = withCleanSupplier(rawDraft);
  const key = nameKey(draft);
  const stamp = nowISO();
  const id = newId();

  return db.transaction("rw", db.items, db.suppliers, async () => {
    const existing: ShelfItem[] = await db.items.where("supplier").equals(draft.supplier).toArray();
    if (existing.some((item) => isInStock(item) && nameKey(item) === key)) return null;

    const item: ShelfItem = {
      ...draft,
      id,
      status: draft.status ?? "in_stock",
      createdAt: stamp,
      updatedAt: stamp,
    };
    const [linked] = await applySupplierLinks([item], stamp);
    await db.items.add(linked);
    return id;
  });
}

export async function updateItem(id: string, patch: Partial<ShelfItem>): Promise<void> {
  const stamp = nowISO();
  // Правка может менять поставщика: чистим и здесь, иначе ручная правка
  // вернула бы в базу «грязное» написание.
  const next =
    typeof patch.supplier === "string" ? withCleanSupplier({ supplier: patch.supplier, ...patch }) : patch;

  // Менялся поставщик — пересчитываем привязку к справочнику.
  if (typeof patch.supplier === "string") {
    await db.transaction("rw", db.items, db.suppliers, async () => {
      const current = await db.items.get(id);
      if (!current) return;
      const [linked] = await applySupplierLinks([{ ...current, ...next, updatedAt: stamp }], stamp);
      await db.items.put(linked);
    });
    return;
  }

  await db.items.update(id, { ...next, updatedAt: stamp });
}

/**
 * «Продано»: в источнике — «продан» в колонке G.
 *
 * Дата продажи — календарный день, как и дата акта ниже. Раньше здесь стоял
 * `nowISO()` (UTC): продажа в 00:30–02:59 по Москве записывалась вчерашним
 * числом и расходилась с актом, который бухгалтерия печатает по местному дню.
 */
export async function markSold(id: string): Promise<void> {
  await db.items.update(id, {
    status: "sold",
    soldAt: toISODate(new Date()),
    writtenOffAt: null,
    updatedAt: nowISO(),
  });
}

/** «Списать»: просроченный товар уходит из наличия с датой акта. */
export async function markWrittenOff(id: string, actDate?: string): Promise<void> {
  await db.items.update(id, {
    status: "written_off",
    // Дата акта — календарная, локальная. UTC-срез в Москве до 03:00 даёт вчера.
    writtenOffAt: actDate || toISODate(new Date()),
    soldAt: null,
    updatedAt: nowISO(),
  });
}

/** Вернуть в наличие — как стереть значение в колонке G. */
export async function returnToStock(id: string): Promise<void> {
  await db.items.update(id, {
    status: "in_stock",
    soldAt: null,
    writtenOffAt: null,
    updatedAt: nowISO(),
  });
}

export async function removeItem(id: string): Promise<void> {
  await db.items.delete(id);
}

export interface SkippedDuplicate {
  name: string;
  supplier: string;
  expiresAt?: string | null;
}

export interface AddItemsResult {
  ids: string[];
  /** Сколько строк не записали, потому что такая позиция уже есть в наличии. */
  skippedDuplicates: number;
  /** Какие именно строки пропустили — чтобы показать пользователю список. */
  skipped: SkippedDuplicate[];
}

/**
 * Одна транзакция на всю накладную: либо попадают все строки, либо ни одной.
 * Раньше каждая строка уходила отдельным addItem — при ошибке на середине
 * получался битый журнал, который было трудно отличить от нормального импорта.
 *
 * Защита от дублей: повторная загрузка того же файла не должна удваивать
 * журнал. Совпадением считается та же позиция того же поставщика с тем же
 * сроком годности и той же датой поступления, которая уже лежит в наличии.
 * Тот же товар с другим сроком или принятый в другой день — это другая партия,
 * её не пропускаем; проданные и списанные — другая история, их не трогаем.
 */
export async function addItems(rawDrafts: ShelfItemDraft[]): Promise<AddItemsResult> {
  if (rawDrafts.length === 0) return { ids: [], skippedDuplicates: 0, skipped: [] };

  // Чистим поставщика до сравнения дублей: иначе позиция из накладной
  // («ООО Ромашка») не совпала бы с уже заведённой («Ромашка») и удвоила журнал.
  const drafts = rawDrafts.map(withCleanSupplier);

  const stamp = nowISO();

  return db.transaction("rw", db.items, db.suppliers, async () => {
    const suppliers = [...new Set(drafts.map((draft) => draft.supplier))];
    const existing: ShelfItem[] = await db.items.where("supplier").anyOf(suppliers).toArray();

    // Совпадение ищем только среди позиций в наличии: проданная или списанная
    // позиция с тем же названием — это уже другая история, её повторная
    // закупка законна.
    const inStock = new Set(existing.filter(isInStock).map(nameKey));

    const skipped: SkippedDuplicate[] = [];
    const fresh = drafts.filter((draft) => {
      const key = nameKey(draft);
      if (inStock.has(key)) {
        skipped.push({ name: draft.name, supplier: draft.supplier, expiresAt: draft.expiresAt });
        return false;
      }
      // Дубль внутри самого файла тоже не нужен.
      inStock.add(key);
      return true;
    });

    const ids = fresh.map(() => newId());
    const items: ShelfItem[] = fresh.map((draft, index) => ({
      ...draft,
      id: ids[index],
      status: draft.status ?? "in_stock",
      createdAt: stamp,
      updatedAt: stamp,
    }));

    const linked = items.length > 0 ? await applySupplierLinks(items, stamp) : [];
    if (linked.length > 0) await db.items.bulkAdd(linked);
    return { ids, skippedDuplicates: skipped.length, skipped };
  });
}
