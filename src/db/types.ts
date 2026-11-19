/**
 * Типы данных «Сроков годности».
 *
 * Ключевое правило проекта (из брифа, раздел 6): срок-статус НЕ хранится,
 * а вычисляется из expiresAt при показе. В Excel именно хранение статуса
 * привело к тому, что колонка F «уехала» и врала на 6 листах из 7.
 */

/** Что стало с позицией. В Excel это колонка G «Выбыл» со значением «продан». */
export type ShelfStatus = "in_stock" | "sold" | "written_off";

export const STATUS_LABEL: Record<ShelfStatus, string> = {
  in_stock: "В наличии",
  sold: "Продан",
  written_off: "Списан",
};

/** Позиция журнала. Соответствие колонкам Excel — в комментариях. */
export interface ShelfItem {
  id: string;
  /** B — Наименование товара */
  name: string;
  /**
   * Отображаемое написание поставщика (лист Excel, накладная, рука человека).
   * При переименовании в справочнике обновляется у связанных позиций — но
   * только когда позиция привязана через `supplierId`.
   */
  supplier: string;
  /**
   * Ссылка на запись справочника — это `Supplier.id`, строка вида
   * «sup-grinfito» (не число: id стабильные и читаемые). `null` — поставщик
   * ещё не сопоставлен. По этому полю переименование находит связанные позиции.
   */
  supplierId?: string | null;
  /** C — Дата поступления партии: строка ISO (YYYY-MM-DD) или null. */
  receivedAt?: string | null;
  /** D — Годен до (ISO). Ключевое поле; пустое = группа «Без срока» */
  expiresAt?: string | null;
  /** H — Честный знак (галочка) */
  marked: boolean;
  /** G — Выбыл: в наличии / продан / списан */
  status: ShelfStatus;
  /** Календарный день продажи (YYYY-MM-DD), без времени: сверяется с актом. */
  soldAt?: string | null;
  /** Календарный день списания (YYYY-MM-DD) — колонка I «Дата акта на списании». */
  writtenOffAt?: string | null;
  /** Свободный комментарий. Для позиций из накладной — источник строки. */
  note?: string | null;
  /** E — Остаток на конец месяца: в источнике пусто во всех 146 строках */
  remainder?: number | null;
  /** I — Дата акта на списании: в источнике пусто во всех 146 строках */
  writeOffActAt?: string | null;
  /** Откуда позиция: импорт из журнала, накладная или ручной ввод. */
  source?: "import" | "invoice" | "manual";
  /** Исходный адрес в Excel — нужен выгрузке «те же 9 колонок, листы по поставщикам». */
  excelSheet?: string | null;
  excelRow?: number | null;
  /** Что было в колонке D, если дату распознать не удалось (например «18.09..29»). */
  rawExpires?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Черновик новой позиции: id и служебные поля ставит приложение. */
export type ShelfItemDraft = Omit<
  ShelfItem,
  "id" | "createdAt" | "updatedAt" | "soldAt" | "writtenOffAt"
> & {
  status?: ShelfStatus;
};

/** Строка настроек (флаги инициализации, режим работы). */
export interface SettingRow {
  id: string;
  value: string;
}

/**
 * Поставщик в справочнике. В Excel это был лист книги; здесь — запись со
 * своим цветом и вариантами написания (см. domain/suppliers.ts).
 */
export interface Supplier {
  id: string;
  /** Имя, как его видит человек (можно переименовать). */
  name: string;
  /** Цвет плашки и вкладки (HEX). */
  color: string;
  /** Другие написания того же поставщика — по ним находят запись из позиций и накладных. */
  aliases: string[];
  /** Скрыт — вкладки и фильтры не показывают, позиции и история остаются. */
  hidden: boolean;
  /** Порядок в списке и среди вкладок. */
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Позиция выбыла из оборота: продан или списан. */
export function isWrittenOff(item: ShelfItem): boolean {
  return item.status === "sold" || item.status === "written_off";
}

export function isInStock(item: ShelfItem): boolean {
  return item.status === "in_stock";
}
