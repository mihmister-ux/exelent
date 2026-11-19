import type { ShelfItem } from "@/db/types";
import { isInStock } from "@/db/types";
import { EXPIRY_STYLE, expiryInfo, type ExpiryInfo, type ExpiryKind } from "@/domain/expiry";
import { addDays, startOfDay, parseISODate, daysBetween } from "@/lib/dates";

/**
 * Группировка экрана «Сроки». Порядок групп — по опасности, как в ТЗ:
 * Просрочено → ≤30 → 31–60 → остальное → Без срока.
 *
 * «Без срока» идёт последней, но НЕ прячется: в источнике 43 строки без даты,
 * и это реальные товары на полке (бриф, раздел 10 — удалять их нельзя).
 */
export const GROUP_ORDER: readonly ExpiryKind[] = ["expired", "soon", "warning", "ok", "no_date"];

export interface GroupMeta {
  id: ExpiryKind;
  title: string;
  hint: string;
}

export const GROUP_META: Record<ExpiryKind, GroupMeta> = {
  expired: { id: "expired", title: "Просрочено", hint: "снять с полки сегодня" },
  soon: { id: "soon", title: "Истекает ≤30 дней", hint: "успеть продать" },
  warning: { id: "warning", title: "Истекает 31–60 дней", hint: "под контролем" },
  ok: { id: "ok", title: "Всё остальное", hint: "больше 60 дней" },
  no_date: { id: "no_date", title: "Без срока", hint: "дату нужно уточнить" },
};

export interface ItemWithExpiry {
  item: ShelfItem;
  expiry: ExpiryInfo;
}

export interface Group {
  meta: GroupMeta;
  /** Позиции группы, уже отсортированные. */
  entries: ItemWithExpiry[];
}

/** Позиции, которые показываем на экране «Сроки»: выбывшие уходят в «Архив». */
export function activeItems(items: ShelfItem[]): ShelfItem[] {
  return items.filter(isInStock);
}

/**
 * Сортировка внутри группы — по дате (так требует ТЗ), у «Без срока» даты нет,
 * поэтому там порядок по названию, а при равенстве — по поставщику.
 */
function compareEntries(a: ItemWithExpiry, b: ItemWithExpiry): number {
  const da = a.expiry.days;
  const db = b.expiry.days;

  if (da !== null && db !== null && da !== db) return da - db;
  if (da !== null && db === null) return -1;
  if (da === null && db !== null) return 1;

  const byName = a.item.name.localeCompare(b.item.name, "ru");
  if (byName !== 0) return byName;
  const bySupplier = a.item.supplier.localeCompare(b.item.supplier, "ru");
  if (bySupplier !== 0) return bySupplier;

  /*
    Две партии одного товара с одним сроком — разные плашки, и порядок между
    ними должен быть устойчивым: сортируем по дате поступления. Без этого
    одинаковые строки прыгали местами при каждом пересчёте, и казалось, что
    список «схлопывается» в одну позицию.
  */
  return (a.item.receivedAt ?? "").localeCompare(b.item.receivedAt ?? "");
}

export function toEntries(items: ShelfItem[], on: Date = startOfDay(new Date())): ItemWithExpiry[] {
  return items.map((item) => ({ item, expiry: expiryInfo(item.expiresAt, on) }));
}

/** Раскладывает позиции по группам в порядке GROUP_ORDER, пустые группы сохраняет. */
export function groupItems(items: ShelfItem[], on: Date = startOfDay(new Date())): Group[] {
  const buckets = new Map<ExpiryKind, ItemWithExpiry[]>();
  for (const id of GROUP_ORDER) buckets.set(id, []);

  for (const entry of toEntries(items, on)) {
    buckets.get(entry.expiry.kind)?.push(entry);
  }

  return GROUP_ORDER.map((id) => {
    const entries = buckets.get(id) ?? [];
    entries.sort(compareEntries);
    return { meta: GROUP_META[id], entries };
  });
}

export interface Summary {
  total: number;
  expired: number;
  soon: number;
  warning: number;
  ok: number;
  noDate: number;
  /** Выбывшие: проданные + списанные. */
  writtenOff: number;
  marked: number;
}

/**
 * Итоги по журналу — замена макроса `ОбновитьЖурнал`, который в источнике
 * пересчитывал строки со статусом «ПРОДАН».
 */
export function summarize(items: ShelfItem[], on: Date = startOfDay(new Date())): Summary {
  const summary: Summary = {
    total: items.length,
    expired: 0,
    soon: 0,
    warning: 0,
    ok: 0,
    noDate: 0,
    writtenOff: 0,
    marked: 0,
  };

  for (const item of items) {
    const kind = expiryInfo(item.expiresAt, on).kind;
    if (kind === "expired") summary.expired += 1;
    else if (kind === "soon") summary.soon += 1;
    else if (kind === "warning") summary.warning += 1;
    else if (kind === "ok") summary.ok += 1;
    else summary.noDate += 1;

    if (item.status !== "in_stock") summary.writtenOff += 1;
    if (item.marked) summary.marked += 1;
  }

  return summary;
}

/** Ближайший по сроку товар в наличии — для подсказки на экране «Сроки». */
export function nearestExpiry(items: ShelfItem[], on: Date = startOfDay(new Date())): ItemWithExpiry | null {
  const dated = toEntries(activeItems(items), on)
    .filter((entry) => entry.expiry.days !== null && parseISODate(entry.item.expiresAt) !== null)
    .sort(compareEntries);
  return dated[0] ?? null;
}

/**
 * Сводка «на неделю» (аудит п.25): позиции в наличии, срок которых истекает
 * в течение `days` дней от `on` (включая уже просроченные). Группируем по дню
 * истечения и сортируем по близости — это строка для утренней плашки и
 * уведомления «что истекает на этой неделе».
 */
export interface WeekExpiry {
  /** Сколько позиций истекает до конца периода. */
  count: number;
  /** Их имена (обрезанные) — чтобы утренняя плашка была конкретной. */
  names: string[];
  /** Первый и последний дни, когда что-то истекает (ISO YYYY-MM-DD). */
  from: string | null;
  to: string | null;
  /** Есть ли среди них уже просроченные сегодня. */
  hasExpired: boolean;
}

export function expiringWithin<Item extends Pick<ShelfItem, "expiresAt" | "status" | "name">>(
  items: Item[],
  on: Date = startOfDay(new Date()),
  days = 7,
): Item[] {
  const horizon = addDays(startOfDay(on), days);
  return items
    .filter((item) => item.status === "in_stock")
    .filter((item) => {
      const d = parseISODate(item.expiresAt);
      if (!d) return false;
      // Просроченные тоже включаем: это самая опасная часть утренней сводки,
      // «что истекает на этой неделе» без них было бы утешительной ложью.
      return startOfDay(d).getTime() <= horizon.getTime();
    })
    .sort((a, b) => (a.expiresAt ?? "").localeCompare(b.expiresAt ?? ""));
}

export function weekExpiry<Item extends Pick<ShelfItem, "expiresAt" | "status" | "name">>(
  items: Item[],
  on: Date = startOfDay(new Date()),
  days = 7,
): WeekExpiry {
  const upcoming = expiringWithin(items, on, days);

  const dates = upcoming
    .map((item) => item.expiresAt?.slice(0, 10))
    .filter((value): value is string => Boolean(value));
  const from = dates.length ? dates[0] : null;
  const to = dates.length ? dates[dates.length - 1] : null;
  const hasExpired = upcoming.some((item) => {
    const d = parseISODate(item.expiresAt);
    return d !== null && daysBetween(on, d) < 0;
  });

  const names = upcoming.map((item) => item.name);

  return { count: upcoming.length, names, from, to, hasExpired };
}

export { EXPIRY_STYLE };
