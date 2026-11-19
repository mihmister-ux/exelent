import type { SheetGrid } from "@/lib/xlsx";
import { toISODate } from "@/lib/dates";

/**
 * Разбор накладной: найти в книге таблицу товаров и вернуть честный
 * предпросмотр. Модуль не знает про Excel-библиотеку — только сетку значений,
 * поэтому его легко тестировать и переиспользовать (PDF позже даст ту же сетку).
 *
 * Главная задача — НЕ принять за товары шапку с реквизитами:
 *   «ИНН 7726…  КПП 7726…  123456, Москва, ул. …»
 * Такая строка похожа на данные (в ней есть числа), но в ней нет ни одного
 * признака товарной колонки. Поэтому сначала ищется заголовок таблицы, и только
 * строки НИЖЕ него считаются товарами.
 */

export type InvoiceColumn =
  | "number"
  | "name"
  | "code"
  | "quantity"
  | "unit"
  | "price"
  | "discount"
  | "vat"
  | "amount"
  | "expiry"
  | "supplier";

export interface InvoiceRow {
  /** Номер строки в исходном листе (1-based) — показывает человеку, откуда взялось. */
  sourceRow: number;
  /** Лист книги или страница PDF, откуда взята строка. */
  sheet: string;
  number: string;
  name: string;
  code: string;
  quantity: string;
  unit: string;
  price: string;
  amount: string;
  /** Дата в ISO (YYYY-MM-DD), если распознана. */
  expiresAt: string | null;
  /** Что было в ячейке с датой, если распознать не вышло. */
  rawExpires: string | null;
  /** Поставщик из колонки/шапки/имени листа. */
  supplier: string;
  /** Почему строка помечена как сомнительная (например, битая дата). */
  warning: string | null;
}

export interface InvoiceParseResult {
  /** Название листа, где нашли таблицу. */
  sheet: string;
  /** Номер строки заголовка в листе (1-based). */
  headerRow: number;
  /** Поставщик, определённый по шапке/листу; пусто — спросим у человека. */
  supplier: string;
  columns: Partial<Record<InvoiceColumn, number>>;
  rows: InvoiceRow[];
  /** Строки, которые пропустили (итоги, реквизиты, пустые) — для прозрачности. */
  skipped: number[];
  /** Насколько уверенно нашли таблицу: 0..1. */
  confidence: number;
  /** Все листы/страницы, откуда взяты строки, в порядке файла. */
  sheets: InvoiceSheetPart[];
  /** Дата документа из шапки (ISO), если нашлась. */
  documentDate: string | null;
  /** Таблица продолжается с предыдущего листа: своего заголовка на нём нет. */
  continuation: boolean;
}

/** Сводка по одному листу книги или странице PDF. */
export interface InvoiceSheetPart {
  sheet: string;
  /** 0 — заголовка на листе нет, колонки унаследованы с предыдущего. */
  headerRow: number;
  rowCount: number;
  skipped: number;
  continuation: boolean;
}

const COLUMN_ALIASES: ReadonlyArray<[InvoiceColumn, readonly string[]]> = [
  ["number", ["№", "н/п", "п/п", "пн", "п/н", "номер", "no", "n"]],
  [
    "name",
    [
      "наименование",
      "наименование товара",
      "товар",
      "товар (услуга)",
      "товары (услуги)",
      "наименование позиции",
      "описание",
      // В счетах 1С колонка названия называется по-разному: «Номенклатура»,
      // «Позиция», «Услуга». Без этих алиасов findHeader не находил заголовок
      // вовсе, и целый файл давал «Не нашёл таблицу товаров». «Номенклатура»
      // осталась и среди кодов ниже — там она только запасной вариант для
      // «Код номенклатуры» (см. matchColumn).
      "номенклатура",
      "позиция",
      "услуга",
      "наименование услуги",
      "услуга (товар)",
      // Английские шапки: счета зарубежных поставщиков приходят с «Name»,
      // «Description», «Item» — без них такой документ не разбирался вовсе.
      "name",
      "description",
      "item",
      "item name",
      "product",
      "goods",
    ],
  ],
  [
    "code",
    ["код", "артикул", "код товара", "код номенклатуры", "номенклатура", "code", "item code", "sku"],
  ],
  ["quantity", ["кол-во", "количество", "кол", "qty", "шт", "quantity"]],
  ["unit", ["ед", "ед.", "ед изм", "единица", "единица измерения", "unit", "uom"]],
  ["price", ["цена", "цена за ед", "цена единицы", "price", "unit price"]],
  // «Скидка» и «НДС» в журнал не пишутся, но нужны проверке суммы: в счёте
  // 2804 «Сумма» = цена × кол-во − скидка, и без учёта скидки предупреждение
  // «цена × кол-во» горело на 12 строках из 16.
  ["discount", ["скидка", "скидка %", "сумма скидки", "discount"]],
  ["vat", ["ндс", "ставка ндс", "в т.ч. ндс", "vat"]],
  ["amount", ["сумма", "сумма всего", "итого", "amount", "total", "sum"]],
  ["expiry", ["годен до", "срок годности", "срок", "дата окончания", "expiry", "best before", "good until"]],
  ["supplier", ["поставщик", "поставщик товара", "фирма", "производитель", "supplier", "vendor"]],
];

/** Слова-маркеры реквизитов: если они в заголовке — это не таблица товаров. */
const REQUISITE_WORDS = [
  "инн", "кпп", "адрес", "телефон", "банк", "р/с", "рс", "бик", "окпо",
  "оквед", "плательщик", "получатель", "покупатель", "организация", "директор",
  "главный бухгалтер", "подпись", "договор", "накладная №",
];

/** Строки-итоги и подписи, которые не должны попасть в журнал. */
const FOOTER_WORDS = [
  "итого", "всего", "итог", "total", "subtotal", "сумма прописью", "прописью",
  "сдал", "принял", "подпись", "главный бухгалтер", "директор", "печать",
  "отпустил", "получил", "разрешил", "заведующий",
];

interface HeaderCandidate {
  rowIndex: number;
  columns: Partial<Record<InvoiceColumn, number>>;
  score: number;
}

/** Шапка начинается с «код»/«артикул» — это колонка кода, а не названия. */
const CODE_HEADER = /^(код|артикул|sku|code|item code)(?![\p{L}])/u;

/** Приводит ячейку заголовка к нижнему регистру «№», «ед.» и т.п. */
function normHeader(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\r\n\t ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchColumn(header: string): InvoiceColumn | null {
  if (!header) return null;
  // Точное совпадение приоритетнее подстроки: «сумма» не должно стать «итого».
  for (const [column, aliases] of COLUMN_ALIASES) {
    if (aliases.some((alias) => header === alias)) return column;
  }
  // «Код номенклатуры» и «Артикул поставщика» — это код, хотя в них есть слово
  // из алиасов названия. Проверка стоит до поиска по подстроке: иначе колонка
  // кода перетягивалась на «номенклатуру» и позиция называлась артикулом.
  if (CODE_HEADER.test(header)) return "code";
  for (const [column, aliases] of COLUMN_ALIASES) {
    if (aliases.some((alias) => alias.length > 1 && header.includes(alias))) return column;
  }
  return null;
}

/**
 * Маркеры-основы: срабатывают и на продолжении слова («итог» → «Итого»,
 * «итогам»). Остальные маркеры обязаны совпасть словом целиком — иначе
 * «банк» ловит «Банка консервная», а «рс» — «ПЕРСИК».
 */
const STEM_MARKERS = new Set(["итог", "всего", "total", "подпись", "прописью"]);

const markerPatterns = new Map<string, RegExp>();

function markerPattern(word: string): RegExp {
  let pattern = markerPatterns.get(word);
  if (!pattern) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tail = STEM_MARKERS.has(word) ? "" : "(?![\\p{L}\\p{N}])";
    pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}${tail}`, "u");
    markerPatterns.set(word, pattern);
  }
  return pattern;
}

/**
 * Маркер ищется СЛОВОМ, а не подстрокой. Прежняя проверка `text.includes(word)`
 * обрывала накладную на обычном товаре: «Фитогель» содержит «итог», «ПЕРСИК» —
 * «рс», «Банка консервная» — «банк», и все позиции ниже молча пропадали
 * из журнала, хотя предпросмотр выглядел полным.
 */
function hasMarker(text: string, words: readonly string[]): boolean {
  return words.some((word) => markerPattern(word).test(text));
}

function looksLikeRequisites(row: unknown[]): boolean {
  const text = row.map(normHeader).join(" ");
  const hasRequisite = hasMarker(text, REQUISITE_WORDS);
  const productColumns = row.filter((value) => matchColumn(normHeader(value))).length;
  return hasRequisite && productColumns < 2;
}

/**
 * Ищет строку заголовка таблицы товаров. Требование: колонка «наименование»
 * и ещё хотя бы одна товарная колонка из набора (код/кол-во/цена/сумма/ед/годен до).
 * Одинокое «наименование организации» не проходит.
 */
function findHeader(sheet: SheetGrid): HeaderCandidate | null {
  let best: HeaderCandidate | null = null;

  sheet.rows.forEach((row, rowIndex) => {
    if (looksLikeRequisites(row)) return;

    const columns: Partial<Record<InvoiceColumn, number>> = {};
    row.forEach((value, columnIndex) => {
      const column = matchColumn(normHeader(value));
      if (column && columns[column] === undefined) columns[column] = columnIndex;
    });

    if (columns.name === undefined) return;

    const productColumns = (["code", "quantity", "unit", "price", "amount", "expiry"] as const)
      .filter((column) => columns[column] !== undefined).length;
    if (productColumns === 0) return;

    const score = productColumns + (columns.number !== undefined ? 0.5 : 0);
    if (!best || score > best.score) best = { rowIndex, columns, score };
  });

  return best;
}

/**
 * Число из ячейки: «1 200,50» → 1200.5, «12,3 кг» → 12.3.
 *
 * Числовые группы вырезаются ЦЕЛИКОМ, а не «выкинуть всё, кроме цифр»: прежний
 * `.replace(/[^\d,.\-]/g, "")` склеивал «3x2» в 32, а «365 за 2 шт» — в 3652,
 * и в журнал уезжало число, которого в документе нет. Если групп несколько,
 * какая из них значение — неизвестно, поэтому возвращаем null: строка получит
 * предупреждение, а не выдуманное число.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const text = String(value)
    .replace(/\s| /g, "")
    .replace(/['\u202f]/g, "");
  if (!text) return null;
  // Скобки — бухгалтерская запись отрицательного: «(3)» это −3. Знак сохраняем,
  // а не отбрасываем: количество ≤ 0 отклоняет сам разбор строки.
  const negative = /^\(.*\)$/.test(text) || /^[-−–—]/.test(text);
  const groups = text.match(/\d+(?:[.,]\d+)*/g);
  if (groups?.length !== 1) return null;
  const number = Number(normalizeSeparators(groups[0]));
  if (!Number.isFinite(number)) return null;
  return negative ? -number : number;
}

/**
 * «1.200,50» → «1200.50». Десятичный разделитель — тот, что правее:
 * в накладных тысячи отделяют точкой, а копейки запятой. Если разделитель
 * один, точка остаётся десятичной.
 */
function normalizeSeparators(text: string): string {
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma === -1) return text;
  if (dot === -1) return text.replace(/,/g, ".");
  return comma > dot ? text.replace(/\./g, "").replace(/,/g, ".") : text.replace(/,/g, "");
}

interface ParsedDate {
  iso: string | null;
  raw: string | null;
  /**
   * День и месяц оба ≤ 12 при разделителе «/»: «01/02/27» — это 2 января или
   * 1 февраля? Читаем по-русски, но помечаем, чтобы сомнение было видно.
   */
  ambiguous?: boolean;
}

/**
 * Месяцы в родительном падеже — так их печатают в счетах на оплату
 * («13 июля 2026 г.»). Индекс массива = номер месяца с нуля.
 */
const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/**
 * Дата из ячейки: Date из Excel, число-сериал, строка «01.02.2027»,
 * «01.02.27», «2027-02-01» или «13 июля 2026 г.». Битая строка
 * («18.09..29») возвращается как raw.
 */
export function parseInvoiceDate(value: unknown): ParsedDate {
  if (value === null || value === undefined || value === "") return { iso: null, raw: null };

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { iso: toISODate(value), raw: null };
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    // Сериал Excel: эпоха 1899-12-30 (учтён високосный 1900).
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return { iso: date.toISOString().slice(0, 10), raw: null };
  }

  const text = String(value).trim();

  // «13 июля 2026 г.» — так печатает дату 1С в счёте на оплату. Без этой ветки
  // дата документа оставалась пустой, и журнал не знал, когда пришёл товар.
  const written = /(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i.exec(text.replace(/ё/gi, "е"));
  if (written) {
    const month = RU_MONTHS.indexOf(written[2].toLowerCase());
    if (month !== -1) {
      const date = new Date(Number(written[3]), month, Number(written[1]));
      if (date.getDate() === Number(written[1])) return { iso: toISODate(date), raw: null };
    }
  }

  // ISO = год-месяц-день, остальное — день/месяц в каком-то порядке. Порядок
  // определяем ЗНАЧЕНИЯМИ, а не разделителем: «11/17/27» и «17.11.27» — одна
  // и та же дата, потому что 17 месяцем быть не может. Разделитель остаётся
  // лишь подсказкой, когда обе группы ≤ 12 и по числам выбрать нельзя.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(text);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return { iso: null, raw: text };
    }
    return { iso: toISODate(date), raw: null };
  }

  // Обратная ссылка \2 требует ОДИН и тот же разделитель: «18.09..29» и
  // «01/02-27» — не дата, а мусор, и должны вернуться как raw.
  const short = /^(\d{1,2})([./])(\d{1,2})\2(\d{4}|\d{2})(?!\d)/.exec(text);
  if (!short) return { iso: null, raw: text };

  const a = Number(short[1]);
  const b = Number(short[3]);
  const sep = short[2];
  let day: number;
  let month: number;
  let ambiguous = false;
  if (a > 12 && b <= 12) {
    // 17 может быть только днём: «17/11/27» — 17 ноября.
    day = a;
    month = b;
  } else if (b > 12 && a <= 12) {
    // 17 во второй группе: «11/17/27» — 17 ноября, а не «17-й месяц».
    month = a;
    day = b;
  } else if (a > 12 && b > 12) {
    // Месяца в такой записи нет вовсе.
    return { iso: null, raw: text };
  } else {
    // Обе группы ≤ 12: числа не различают день и месяц, читаем по-русски
    // (день.месяц). Но «/» выдаёт выгрузку из англоязычной системы, где
    // порядок обратный, — помечаем сомнение, не отказываясь от даты.
    day = a;
    month = b;
    if (sep === "/" && a !== b) ambiguous = true;
  }

  const yearRaw = Number(short[4]);
  const year = yearRaw < 100 ? (yearRaw >= 70 ? 1900 + yearRaw : 2000 + yearRaw) : yearRaw;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { iso: null, raw: text };
  }
  // Ключ ambiguous только когда он true: иначе у каждой даты появлялось бы
  // лишнее поле, и строгие сравнения объектов в тестах ломались бы.
  return ambiguous
    ? { iso: toISODate(date), raw: null, ambiguous: true }
    : { iso: toISODate(date), raw: null };
}

function cellText(row: unknown[], index: number | undefined): string {
  if (index === undefined) return "";
  const value = row[index];
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toISODate(value);
  return String(value).trim();
}

function isFooter(row: unknown[]): boolean {
  const text = row.map(normHeader).filter(Boolean).join(" ");
  return hasMarker(text, FOOTER_WORDS);
}

function isBlank(row: unknown[]): boolean {
  return row.every((value) => value === null || value === undefined || String(value).trim() === "");
}

function looksLikeRequisitionRow(row: unknown[]): boolean {
  const text = row.map(normHeader).filter(Boolean).join(" ");
  return hasMarker(text, REQUISITE_WORDS);
}

/**
 * Название документа в шапке: «Счет на оплату», «Накладная», «Invoice».
 *
 * Это НЕ «любое упоминание счёта в строке», а именно заголовок документа.
 * Разница принципиальная: «Основание: Договор … от 09.11.2023г.» тоже стоит
 * в шапке и тоже содержит дату, но дата там — дата договора, а не документа.
 */
const DOCUMENT_TITLE = /(?:счет|счёт|накладная|invoice)\s*(?:на\s*оплату)?\s*(?:№|N|no\.?|#)?/i;

/**
 * Строка «Основание: …» — запасной источник даты, но только если в шапке
 * заголовка документа не нашлось.
 */
const BASIS_LINE = /^\s*основани[ея]/i;

/**
 * Из «Накладная № 451 от 12.11.2026» или «Счет на оплату № 640 от 13 июля 2026 г.»
 * достаём дату поступления.
 *
 * Порядок источников жёсткий, и это суть алгоритма:
 *
 *   1. Строка-заголовок документа в ВЕРХНЕЙ части файла («Счет на оплату № …
 *      от …» / «Накладная № … от …»), у которой после названия документа идёт
 *      «от» + дата. Дата берётся оттуда.
 *   2. Только если такой строки нет — строка «Основание: …» (дата договора):
 *      без неё часть накладных осталась бы вовсе без даты.
 *   3. И только потом — любая дата в шапке, как последняя надежда.
 *
 * Почему нельзя просто искать «любую дату со словом счёт рядом»: в реальном
 * счёте от «РИФ И КО» заголовок стоит на 17-й строке («Счет на оплату № 640
 * от 13 июля 2026 г.»), а «Основание: Договор №2023/50 от 09.11.2023г.» — на
 * 28-й. Прежний проход шёл СНИЗУ вверх и цеплял договор, записывая в журнал
 * 2023 год вместо 2026-го — дата поступления товара была неверной.
 */
export function findDocumentDate(sheet: SheetGrid, headerIndex: number): string | null {
  const ANY_DATE = /от\s*\d/i;

  const textAt = (index: number): string =>
    sheet.rows[index]
      .filter((value) => value !== null && value !== undefined)
      .map((value) => (value instanceof Date ? toISODate(value) : String(value)))
      .join(" ");

  const dateIn = (text: string): string | null => {
    // День и месяц бывают однозначными («от 3.2.2026»), год — двузначным
    // («26.10.26»), а 1С печатает «13 июля 2026 г.» словами.
    const found =
      /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)?.[0] ??
      /(\d{1,2})[.](\d{1,2})[.](\d{4})/.exec(text)?.[0] ??
      /(\d{1,2})\s+[а-яё]+\s+(\d{4})/i.exec(text)?.[0] ??
      /(\d{1,2})[.](\d{1,2})[.](\d{2})(?!\d)/.exec(text)?.[0] ??
      "";
    const parsed = parseInvoiceDate(found);
    return parsed.iso;
  };

  /**
   * Дата из заголовка документа: «Счет на оплату № 640 от 13 июля 2026 г.».
   *
   * Требуем, чтобы «от» + дата шли ПОСЛЕ названия документа, а не до него:
   * иначе строка вида «Договор от 09.11.2023 на оплату…» снова протащила бы
   * дату договора, хотя слово «оплату» в ней есть.
   */
  const dateFromTitle = (text: string): string | null => {
    const title = DOCUMENT_TITLE.exec(text);
    if (!title) return null;
    const after = text.slice(title.index + title[0].length);
    if (!ANY_DATE.test(after)) return null;
    return dateIn(after);
  };

  // Заголовок документа живёт в верхней части документа, над таблицей товаров.
  // Шапка длиннее 12 строк бывает (реквизиты банка, поставщик, покупатель,
  // основание), поэтому окно берём с запасом — но строго ВЫШЕ заголовка таблицы,
  // чтобы не поймать дату в товарах.
  const top = Math.max(0, headerIndex - 30);
  const candidates: number[] = [];
  for (let index = top; index < headerIndex; index += 1) candidates.push(index);

  // 1. Заголовок документа. Идём сверху вниз: первый заголовок в файле — он и есть.
  for (const index of candidates) {
    const iso = dateFromTitle(textAt(index));
    if (iso) return iso;
  }

  // 2. Запасной источник — «Основание: … от …».
  for (const index of candidates) {
    const text = textAt(index);
    if (!BASIS_LINE.test(text)) continue;
    const iso = dateIn(text.slice(text.search(/от\s*\d/i)));
    if (iso) return iso;
  }

  // 3. Последняя надежда: любая дата в шапке рядом с «от».
  for (const index of candidates) {
    const text = textAt(index);
    if (!ANY_DATE.test(text)) continue;
    const iso = dateIn(text);
    if (iso) return iso;
  }
  return null;
}

/**
 * Поставщик из шапки: «Поставщик: ООО Лотос» / «Supplier: Farm Zavod Galen LLC».
 *
 * В PDF ячейка поставщика часто содержит всю реквизитную строку целиком:
 * «Общество с ограниченной ответственностью "РИФ И КО", ИНН 0400001746,
 * КПП 040001001, 649002, Алтай респ, …». В журнал нужно имя организации, а не
 * адрес с ИНН, поэтому строка обрезается по первому реквизитному маркеру.
 */
function findSupplierInHeader(sheet: SheetGrid, headerIndex: number): string {
  for (let index = 0; index < headerIndex; index += 1) {
    const row = sheet.rows[index];
    for (let column = 0; column < row.length; column += 1) {
      const text = normHeader(row[column]);
      if (!/^(поставщик|supplier|vendor)/.test(text)) continue;

      const same = cellText(row, column + 1);
      if (same && !/^(поставщик|supplier|vendor)/.test(normHeader(same))) {
        return trimSupplier(same);
      }

      const whole = row.map((value) => String(value ?? "").trim()).join(" ");
      const match = /(?:поставщик|supplier|vendor)\s*:?\s*(.+)$/i.exec(whole);
      if (match?.[1]) return trimSupplier(match[1]);
    }
  }
  return "";
}

/**
 * Отрезает от строки поставщика реквизиты: ИНН, КПП, адрес, телефон.
 *
 * Границы слова `\b` здесь неприменимы: в JavaScript она считается по `\w`,
 * то есть по латинице и цифрам, а кириллица для неё — не-слово. Из-за этого
 * «ИНН» после пробела не находился, и в журнал уезжала вся реквизитная строка.
 */
function trimSupplier(value: string): string {
  // INN/KPP — те же ИНН/КПП латиницей: так их печатает счёт зарубежного
  // поставщика, и без них адрес с реквизитами оставался в имени поставщика.
  const markers = /,?\s*(?:ИНН|КПП|ОГРН|ОКПО|INN|KPP|OGRN|адрес|address|тел\.?|phone|р\/с|бик)\s*[:№]/i;
  const numbers = /,?\s*(?:ИНН|КПП|ОГРН|ОКПО|INN|KPP|OGRN)\s+\d/i;
  // Нужна РАННЯЯ из найденных границ. Регулярки ищут разное: «ИНН 2224031168»
  // без двоеточия ловит вторая, «тел.: …» — первая. Если взять позднюю, между
  // ними в имя поставщика уезжает вся реквизитная строка с адресом.
  const found = [value.search(markers), value.search(numbers)].filter((index) => index !== -1);
  const at = found.length > 0 ? Math.min(...found) : -1;
  const name = (at === -1 ? value : value.slice(0, at)).replace(/[,\s]+$/, "").trim();
  return name || value.trim();
}

/**
 * Имя листа — последний источник поставщика; служебные имена игнорируем.
 *
 * «Страница 1» — имя, которое pdf.ts само даёт прочитанным страницам. Раньше
 * оно проходило проверку и становилось поставщиком, попадая в журнал вместо
 * реального «ООО РИФ И КО» из шапки.
 */
function supplierFromSheet(name: string): string {
  const clean = name.trim();
  if (!clean) return "";
  if (/^(лист\s*\d*|sheet\d*|товары|накладная|table\d*|страница\s*\d*|page\s*\d*)$/i.test(clean)) return "";
  return clean;
}

/**
 * Ячейка содержит только число — «2», «2.», «2 014», «43 720,00» — это номер
 * строки или итог, а не название товара.
 *
 * Пробелы внутри разрешены намеренно: в счётах суммы печатают с разделителем
 * тысяч («43 720»), и без этого строка итогов без подписи («159» и «43 720»
 * в колонках количества и суммы) попадала в журнал товаром с наименованием
 * «43 720». Буквы по-прежнему означают название: «Крем 5 мл» числом не станет.
 */
function isNumericCell(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  if (!/^[\d\s.,-]+$/.test(text)) return false;
  return parseNumber(text) !== null;
}

/**
 * В счётах-фактурах строка сразу под заголовком — это нумерация колонок
 * «1 2 3 4 5», а не товары. Отличаем её по набору коротких чисел и по тому,
 * что ни в одной товарной колонке нет осмысленного значения.
 *
 * Начинаться нумерация обязана с единицы: без этого под правило попадала
 * любая строка из коротких чисел, и позиция с артикулом вместо названия
 * («12345», количество 3) молча выбрасывалась из журнала.
 */
function isColumnNumberingRow(
  row: unknown[],
  columns: Partial<Record<InvoiceColumn, number>>,
): boolean {
  const cells = Object.values(columns)
    .filter((index): index is number => index !== undefined)
    .map((index) => cellText(row, index))
    .filter(Boolean);
  if (cells.length < 2) return false;
  if (cells[0] !== "1") return false;
  const numeric = cells.filter(isNumericCell).length;
  const allShort = cells.every((cell) => cell.length <= 5);
  return numeric >= Math.max(2, Math.ceil(cells.length * 0.6)) && allShort;
}

/**
 * Название позиции без двух букв — не название. Отсекает «---», «...»,
 * «12345-678» и прочие разделители/коды, которые прежде становились товаром
 * с мусорным именем: такая строка должна уйти в skipped и быть видна человеку.
 */
function hasEnoughLetters(text: string): boolean {
  return (text.match(/\p{L}/gu) ?? []).length >= 2;
}

/**
 * Берём наименование из соседней колонки, если в «Наименовании» оказалось
 * число/номер строки из-за сдвига колонок в выгрузке.
 */
function resolveName(
  row: unknown[],
  columns: Partial<Record<InvoiceColumn, number>>,
): string {
  const direct = cellText(row, columns.name);
  if (direct && !isNumericCell(direct) && hasEnoughLetters(direct)) return direct;

  // «Наименование» не дало названия: пусто, голое число (сдвиг колонок) или
  // строка без букв («---») — значит название уехало в соседнюю ячейку.
  // Кандидаты: всё справа и слева от колонки name. При сдвиге колонок
  // настоящее название может оказаться даже там, где обычно количество,
  // поэтому «служебные» колонки не исключаем — их защищают проверки ниже:
  // числа отсекает isNumericCell, коды/артикулы — regex `[A-Za-z0-9/_\-]`.
  const order = [...row.keys()].sort(
    (a, b) =>
      Math.abs(a - (columns.name ?? 0)) - Math.abs(b - (columns.name ?? 0)),
  );
  for (const index of order) {
    if (index === columns.number) continue;
    const text = cellText(row, index);
    if (!text || isNumericCell(text)) continue;
    // Код товара/артикул — не название: это цифры или артикул латиницей.
    if (/^[A-Za-z0-9\-_/]+$/.test(text)) continue;
    if (!hasEnoughLetters(text)) continue;
    return text;
  }

  // Название так и не нашли. Голое число вернуть как имя нельзя: это «2»
  // (нумерация) или «43 720» (итог). Прежнее исключение для артикула из
  // четырёх знаков («12345», «0870») убрано: оно протаскивало в журнал
  // строки без наименования, и позиция называлась числом.
  return "";
}

/** Сколько колонок таблицы реально заполнено в строке. */
function filledColumns(row: unknown[], columns: Partial<Record<InvoiceColumn, number>>): number {
  return Object.values(columns).filter(
    (index) => index !== undefined && cellText(row, index) !== "",
  ).length;
}

/** Сколько пустых строк подряд считаем «пробелом» внутри таблицы, а не концом. */
const MAX_BLANK_GAP = 3;

/**
 * Есть ли ниже ещё товар. Нужен, чтобы пустая строка в середине накладной
 * (разделитель между группами в выгрузке из 1С) не обрывала разбор —
 * иначе позиции после неё молча не попадали в журнал.
 */
function goodsAhead(
  sheet: SheetGrid,
  from: number,
  columns: Partial<Record<InvoiceColumn, number>>,
): boolean {
  const limit = Math.min(sheet.rows.length, from + MAX_BLANK_GAP);
  for (let index = from; index < limit; index += 1) {
    const row = sheet.rows[index];
    if (isBlank(row)) continue;
    if (isFooter(row) || looksLikeRequisitionRow(row)) return false;
    return cellText(row, columns.name) !== "" || filledColumns(row, columns) >= 2;
  }
  return false;
}

/**
 * Разбирает один лист. Возвращает null, если таблицы товаров на нём нет.
 *
 * `inherited` — колонки и поставщик с предыдущего листа/страницы: вторая
 * страница PDF и следующий лист книги часто идут без заголовка, и без
 * наследования эти позиции молча терялись.
 */
export function parseInvoiceSheet(
  sheet: SheetGrid,
  inherited?: { columns: Partial<Record<InvoiceColumn, number>>; supplier: string },
): InvoiceParseResult | null {
  const header = findHeader(sheet);
  const continuation = header === null && inherited !== undefined;
  if (!header && !inherited) return null;

  const headerIndex = header ? header.rowIndex : -1;
  const columns = header ? header.columns : inherited!.columns;
  const headerSupplier = header ? findSupplierInHeader(sheet, header.rowIndex) : "";
  const supplier = headerSupplier || supplierFromSheet(sheet.name) || (inherited?.supplier ?? "");
  const rows: InvoiceRow[] = [];
  const skipped: number[] = [];
  let sawData = false;

  for (let index = headerIndex + 1; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index];
    const sourceRow = index + 1;

    if (isBlank(row)) {
      // Пустая строка — не всегда конец таблицы: в выгрузках она разделяет
      // группы товаров. Обрываем разбор, только если ниже товара нет.
      if (sawData && !goodsAhead(sheet, index + 1, columns)) break;
      skipped.push(sourceRow);
      continue;
    }
    if (isFooter(row) || looksLikeRequisitionRow(row)) {
      // Обрываем разбор только если ниже товара действительно нет: одно
      // ложное срабатывание маркера не должно уносить весь остаток накладной.
      if (sawData && !goodsAhead(sheet, index + 1, columns)) break;
      skipped.push(sourceRow);
      continue;
    }

    if (isColumnNumberingRow(row, columns)) {
      // Строка «1 2 3 4 5 6 7 8» под заголовком счёта — не товары.
      skipped.push(sourceRow);
      continue;
    }

    const name = resolveName(row, columns);
    if (!name) {
      // Без наименования позиции не существует: это либо продолжение
      // объединённой ячейки, либо служебная строка. В журнал не берём.
      skipped.push(sourceRow);
      if (sawData && !goodsAhead(sheet, index + 1, columns)) break;
      continue;
    }

    sawData = true;
    const expiryCell = columns.expiry === undefined ? null : row[columns.expiry];
    const date = parseInvoiceDate(expiryCell);
    const number = parseNumber(cellText(row, columns.number));
    const rawQuantityCell = cellText(row, columns.quantity);
    // При сдвиге колонок название может оказаться в ячейке количества
    // (resolveName уже нашёл его там). Это не «нечитаемое количество», а
    // пустая ячейка: не выбрасываем строку и не пишем имя в количество.
    const shiftedIntoQuantity = rawQuantityCell !== "" && rawQuantityCell === name;
    const quantityCell = shiftedIntoQuantity ? "" : rawQuantityCell;
    const quantity = parseNumber(quantityCell);
    const price = parseNumber(cellText(row, columns.price));
    const amount = parseNumber(cellText(row, columns.amount));
    const warnings: string[] = [];
    if (columns.expiry !== undefined && expiryCell !== null && expiryCell !== undefined && expiryCell !== "") {
      if (date.iso === null && date.raw) warnings.push("не удалось распознать дату срока");
    }
    if (columns.quantity !== undefined && quantityCell !== "" && quantity === null) {
      // Ячейка не пуста, но числа в ней нет («3x2», «5 шт ...», «две»). Такую
      // строку нельзя брать в журнал: прежний код оставлял её с сырым
      // количеством, и позиция выглядела полноценной, хотя число в ней
      // выдумано/нечитаемо. Показываем номер в skipped — человек поправит.
      skipped.push(sourceRow);
      continue;
    }
    if (quantity !== null && quantity <= 0) {
      // Нулевое или отрицательное количество — не позиция (пустая ячейка,
      // возврат, итог). В rows не берём, но номер строки показываем.
      skipped.push(sourceRow);
      continue;
    }
    if (price !== null && price > 0 && quantity !== null && amount !== null && amount > 0) {
      // «Сумма» редко равна «цена × кол-во»: в счетах 1С между ними стоит
      // «Скидка», и без неё предупреждение горело на 12 строках из 16.
      // Скидка бывает и суммой, и процентом — считаем оба варианта.
      // «НДС» намеренно не участвует: вычитать его из «Суммы» нельзя, она уже
      // итоговая (в фикстурах колонки НДС и вовсе нет).
      const discountCell = cellText(row, columns.discount);
      const base = price * quantity;
      const variants = [base];
      const discount = parseNumber(discountCell);
      if (discount !== null && discount > 0) {
        // «Скидка» бывает суммой и процентом: «3%» → 0.03.
        variants.push(/%/.test(discountCell) ? base * (1 - discount / 100) : base - discount);
      }
      const ok = variants.some((v) => Math.abs(v - amount) <= Math.max(1, Math.abs(v) * 0.005));
      if (!ok) warnings.push(`цена × кол-во = ${base}, в таблице ${amount}`);
    }

    rows.push({
      sourceRow,
      sheet: sheet.name,
      number: number === null ? cellText(row, columns.number) : String(number),
      name,
      code: cellText(row, columns.code),
      quantity: quantity === null ? cellText(row, columns.quantity) : String(quantity),
      unit: cellText(row, columns.unit),
      price: price === null ? cellText(row, columns.price) : String(price),
      amount: amount === null ? cellText(row, columns.amount) : String(amount),
      expiresAt: date.iso,
      rawExpires: date.raw,
      supplier: cellText(row, columns.supplier) || supplier,
      warning: warnings.length ? warnings.join("; ") : null,
    });
  }

  const confidence = Math.min(
    1,
    0.45 + Object.keys(columns).length * 0.06 + Math.min(rows.length, 10) * 0.02,
  );

  return {
    sheet: sheet.name,
    headerRow: headerIndex + 1,
    supplier,
    columns,
    rows,
    skipped,
    confidence,
    continuation,
    documentDate: header ? findDocumentDate(sheet, headerIndex) : null,
    sheets: [
      {
        sheet: sheet.name,
        headerRow: headerIndex + 1,
        rowCount: rows.length,
        skipped: skipped.length,
        continuation,
      },
    ],
  };
}

/** Продолжение таблицы с другого листа принимаем, только если строки на него похожи. */
function looksLikeTableContinuation(rows: InvoiceRow[]): boolean {
  if (rows.length === 0) return false;
  const withNumbers = rows.filter(
    (row) => parseNumber(row.quantity) !== null || parseNumber(row.amount) !== null,
  ).length;
  return withNumbers / rows.length >= 0.5;
}

/**
 * Все листы книги и страницы PDF, где есть таблица товаров, — одним
 * результатом. Лист без собственного заголовка считается продолжением
 * предыдущего (колонки наследуются), но только если его строки похожи
 * на товары: иначе лист «Справочники» после накладной превратился бы в журнал.
 */
export function parseInvoice(sheets: SheetGrid[]): InvoiceParseResult | null {
  const parts: InvoiceParseResult[] = [];
  let inherited: { columns: Partial<Record<InvoiceColumn, number>>; supplier: string } | undefined;

  for (const sheet of sheets) {
    const result = parseInvoiceSheet(sheet, inherited);
    if (!result || result.rows.length === 0) continue;
    if (result.continuation && !looksLikeTableContinuation(result.rows)) continue;
    parts.push(result);
    inherited = { columns: result.columns, supplier: result.supplier };
  }

  if (parts.length === 0) return null;
  const first = parts[0];
  // Шапка и имя листа — не единственные источники поставщика. В накладных
  // с колонкой «Поставщик» (invoice-lotos.xlsx) шапки нет вовсе, но каждая
  // строка подписана. Раньше result.supplier оставался пустым, хотя UI потом
  // всё равно находил доминирующее значение по строкам — API и экран
  // расходились. Записываем его здесь, чтобы zk и тесты видели одно и то же.
  // Файлы без поставщика вообще (invoice-no-supplier.xlsx) остаются пустыми:
  // приложение честно спросит его у человека, а не выдумает «Лотос».
  const fromRows = new Map<string, number>();
  for (const part of parts) {
    for (const row of part.rows) {
      const value = row.supplier.trim();
      if (value) fromRows.set(value, (fromRows.get(value) ?? 0) + 1);
    }
  }
  const dominant = [...fromRows.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return {
    ...first,
    rows: parts.flatMap((part) => part.rows),
    sheets: parts.flatMap((part) => part.sheets),
    skipped: parts.flatMap((part) => part.skipped),
    supplier: parts.find((part) => part.supplier)?.supplier || dominant,
    documentDate: parts.find((part) => part.documentDate)?.documentDate ?? null,
    confidence: Math.max(...parts.map((part) => part.confidence)),
  };
}
