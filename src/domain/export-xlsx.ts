import * as XLSX from "xlsx";

import { STATUS_LABEL, type ShelfItem, type Supplier } from "@/db/types";
import { expiryInfo } from "@/domain/expiry";
import { buildSupplierIndex, supplierDisplayName } from "@/domain/suppliers";
import { parseISODate, toISODate } from "@/lib/dates";

/**
 * Выгрузка журнала в .xlsx — «те же 9 колонок и отдельный лист на поставщика».
 *
 * Здесь только чистое преобразование данных в книгу: ни Dexie, ни DOM. Поэтому
 * результат можно проверить тестом, а экран остаётся тонким (собрал данные —
 * позвал `journalWorkbook` — скачал байты на устройство).
 *
 * Колонки повторяют исходный журнал столбец в столбец (A…I), включая правило
 * «статус не хранится, а вычисляется»: F и G считаются из даты и статуса на
 * момент выгрузки, а не берутся из базы. Именно хранение статуса в Excel и
 * привело к тому, что колонка F врала на 6 листах из 7.
 */

/** Заголовки девяти колонок журнала; индекс = номер колонки − 1. */
export const JOURNAL_HEADERS = [
  "п/н",
  "Наименование товара",
  "Дата поступления",
  "Годен до",
  "Остаток на конец месяца",
  "Истёк срок годности",
  "Выбыл",
  "Честный знак",
  "Дата акта на списании",
] as const;

/** Ширина колонок в символах — чтобы в Excel не пришлось тянуть каждую. */
const COLUMN_WIDTHS = [6, 52, 17, 13, 20, 18, 12, 14, 20];

/**
 * Предел длины имени листа в Excel — 31 символ, и в имени запрещены
 * `: \ / ? * [ ]`. Имена листов в источнике обрезаны ровно так же
 * («ЛБренд Кавказский травник (ист1»).
 */
export function sheetName(raw: string, taken: Set<string> = new Set()): string {
  const base =
    raw
      .replace(/[:\\/?*[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || "Поставщик";

  if (!taken.has(base.toLowerCase())) {
    taken.add(base.toLowerCase());
    return base;
  }

  // Однофамильцы (два поставщика с одинаковым именем листа) — нумеруем хвост.
  for (let i = 2; i < 100; i += 1) {
    const suffix = ` (${i})`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }

  const fallback = `Лист ${taken.size + 1}`;
  taken.add(fallback.toLowerCase());
  return fallback;
}

/** Дата для ячейки: настоящая дата Excel (а не текст), пустая ячейка — null. */
function dateCell(value?: string | null): Date | null {
  return parseISODate(value ?? null);
}

/**
 * Исходный текст даты, которую не удалось разобрать («18.09..29»).
 * В колонке D текст лучше, чем пустота: человек видит, что там было.
 */
function rawDateCell(item: ShelfItem): { v: string } | null {
  const raw = item.rawExpires?.trim();
  return raw ? { v: raw } : null;
}

/** «Выбыл»: в источнике — слово «продан»; в наличии ячейка пустая. */
function writtenOffCell(item: ShelfItem): string {
  if (item.status === "in_stock") return "";
  return STATUS_LABEL[item.status].toLowerCase();
}

/** Одна строка журнала в порядке колонок A…I. */
export function itemRow(item: ShelfItem, index: number, on: Date): unknown[] {
  const expiry = expiryInfo(item.expiresAt, on);
  const writtenOff = item.status !== "in_stock";

  // Списанный товар срока уже не имеет смысла: он выбыл раньше.
  const expiredCell = writtenOff ? "" : expiry.excelFCell;

  return [
    index + 1,
    item.name,
    dateCell(item.receivedAt),
    dateCell(item.expiresAt) ?? rawDateCell(item),
    item.remainder ?? null,
    expiredCell,
    writtenOffCell(item),
    item.marked ? "да" : "",
    dateCell(item.writeOffActAt ?? item.writtenOffAt),
  ];
}

/**
 * Сортировка внутри листа: «п/н» идёт по номеру строки исходного журнала —
 * так выгрузка читается как привычная таблица, а не как порядок в base.
 */
function compareForSheet(a: ShelfItem, b: ShelfItem): number {
  const ra = a.excelRow ?? Number.MAX_SAFE_INTEGER;
  const rb = b.excelRow ?? Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name, "ru");
}

/**
 * Кто на каком листе: имя листа берётся из написания в позиции, но приведённое
 * к справочнику («ГРИНФИТО ООО» → «Гринфито»). Так после объединения
 * поставщиков выгрузка не расползается на два листа.
 */
function sheetKey(item: ShelfItem, index: ReturnType<typeof buildSupplierIndex>): string {
  return supplierDisplayName(index, item.supplier);
}

export interface WorkbookOptions {
  /** Дата, на которую считается «истёк срок» (по умолчанию — сегодня). */
  on?: Date;
  /** Справочник поставщиков: задаёт порядок листов и их имена. */
  suppliers?: readonly Supplier[];
}

/**
 * Собирает книгу: один лист на поставщика, те же 9 колонок.
 *
 * Позиции, чей поставщик позже был объединён или переименован, попадают на
 * лист актуального имени. Порядок листов — порядок вкладок, а не алфавит:
 * человек ищет поставщика там же, где привык видеть его в приложении.
 */
export function journalWorkbook(
  items: readonly ShelfItem[],
  options: WorkbookOptions = {},
): XLSX.WorkBook {
  const on = options.on ?? new Date();
  const directory = buildSupplierIndex(options.suppliers ?? []);
  const taken = new Set<string>();

  const groups = new Map<string, ShelfItem[]>();
  for (const item of items) {
    const key = sheetKey(item, directory);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const order = (options.suppliers ?? [])
    .slice()
    .sort((a, b) => (a.hidden === b.hidden ? a.order - b.order : a.hidden ? 1 : -1))
    .map((supplier) => supplier.name);

  const names = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== ib) return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
    return a.localeCompare(b, "ru");
  });

  const book = XLSX.utils.book_new();

  for (const name of names) {
    const rows: unknown[][] = [
      JOURNAL_HEADERS as unknown as string[],
      ...groups.get(name)!.slice().sort(compareForSheet).map((item, index) => itemRow(item, index, on)),
    ];

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));
    sheet["!freeze"] = { xSplit: 0, ySplit: 1 };

    XLSX.utils.book_append_sheet(book, sheet, sheetName(name, taken));
  }

  // Ни одной позиции — книга не должна быть «битой»: пустой лист с шапкой.
  if (book.SheetNames.length === 0) {
    const sheet = XLSX.utils.aoa_to_sheet([JOURNAL_HEADERS as unknown as string[]]);
    sheet["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(book, sheet, "Журнал");
  }

  return book;
}

/** Байты книги — ровно то, что уходит в файл на устройство. */
export function workbookBytes(book: XLSX.WorkBook): Uint8Array {
  // bookType "xlsx" (не "xlsm"): макросов в выгрузке нет, чужие их не ждут.
  return XLSX.write(book, { bookType: "xlsx", type: "array" });
}

/** «Сроки хранения — 2026-11-17 14.30.xlsx». */
export function journalFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = toISODate(now);
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return `Сроки хранения — ${date} ${time}.xlsx`;
}
