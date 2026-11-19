/**
 * Справочник поставщиков как данные.
 *
 * В Excel поставщик задавался листом книги: «ГРИНФИТО ООО», «Лотос ООО»,
 * «ЛБренд Кавказский травник (ист1» — имена листов, обрезанные по 31 символу.
 * В накладных тот же поставщик пишется иначе («Гринфито», «Лотос»). Поэтому
 * у каждого поставщика есть:
 *
 *   name    — как его видит человек (можно переименовать),
 *   aliases — варианты написания, по которым позиции и накладные находят запись,
 *   color   — цвет плашки и вкладки.
 *
 * Позиции журнала при этом не переписываются: строки хранят то написание,
 * которое пришло из Excel или из накладной.
 */

import type { Supplier } from "@/db/types";
import { cleanSupplierName, sameSpelling, supplierNameKey } from "@/domain/supplier-name";

/** Служебный идентификатор вкладки «Все». */
export const ALL_SUPPLIER_IDS = "all";

/**
 * Палитра для новых поставщиков: тёмные оттенки, чтобы белый текст на плашке
 * читался (контраст не ниже 4.5:1). Первые семь заняты поставщиками журнала.
 */
export const SUPPLIER_PALETTE: readonly string[] = [
  "#15803d", // зелёный — Гринфито
  "#1d4ed8", // синий — Две Линии
  "#a16207", // тёмно-жёлтый — Лотос
  "#7e22ce", // фиолетовый — Пенталис
  "#0f766e", // бирюзовый — Риф и Ко
  "#be123c", // малиновый — Алфит
  "#334155", // графит — ЛБренд
  "#b45309", // охра
  "#0369a1", // сталь
  "#4d7c0f", // олива
  "#9d174d", // вишня
  "#4338ca", // индиго
];

/** Цвет поставщика, которого нет в справочнике: нейтральный серый. */
export const UNKNOWN_SUPPLIER_COLOR = "#64748b";

/** Short label used in dense badges and horizontal supplier tabs. */
export function supplierShort(raw: string): string {
  const pretty = prettifySupplierName(raw);
  return pretty.length > 24 ? `${pretty.slice(0, 23)}…` : pretty;
}

/** Visual tone for a supplier name, resolved from the built-in directory. */
export function supplierTone(raw: string): { bg: string; fg: string } {
  return supplierToneFrom(defaultSuppliers(), raw);
}

/** Resolve a display label from the live supplier directory. */
export function supplierShortFrom(suppliers: readonly Supplier[], raw: string): string {
  const index = buildSupplierIndex(suppliers);
  return supplierShort(findSupplier(index, raw)?.name ?? raw);
}

/** Resolve a visual tone from the live supplier directory. */
export function supplierToneFrom(suppliers: readonly Supplier[], raw: string): { bg: string; fg: string } {
  const index = buildSupplierIndex(suppliers);
  const bg = findSupplier(index, raw)?.color ?? UNKNOWN_SUPPLIER_COLOR;
  return { bg, fg: "#ffffff" };
}

/**
 * Справочник первого запуска: семь поставщиков журнала из `data/shelf-data.json`.
 * `order` задаёт порядок вкладок — как листы в книге Excel.
 */
export function defaultSuppliers(): Supplier[] {
  const seed: Array<Omit<Supplier, "id" | "createdAt" | "updatedAt">> = [
    { name: "Гринфито", color: "#15803d", aliases: ["ГРИНФИТО ООО"], hidden: false, order: 10 },
    { name: "Две Линии", color: "#1d4ed8", aliases: ["Две Линии"], hidden: false, order: 20 },
    { name: "Лотос", color: "#a16207", aliases: ["Лотос ООО"], hidden: false, order: 30 },
    { name: "Пенталис", color: "#7e22ce", aliases: ["Пенталис"], hidden: false, order: 40 },
    { name: "Риф и Ко", color: "#0f766e", aliases: ["Риф и Ко"], hidden: false, order: 50 },
    { name: "Алфит", color: "#be123c", aliases: ["Алфит"], hidden: false, order: 60 },
    {
      name: "ЛБренд (Кавказский травник)",
      color: "#334155",
      aliases: ["ЛБренд Кавказский травник (ист1"],
      hidden: false,
      order: 70,
    },
  ];

  return seed.map((entry) => ({ ...entry, id: `sup-${slugify(entry.name)}` }));
}

/**
 * Ключ сравнения имён.
 *
 * Делегирует в `supplierNameKey`, который чистит имя через `cleanSupplierName`.
 * Прежняя версия чистила регулярками с `\b`, а в JavaScript `\b` считается по
 * `\w` — латинице и цифрам. Для кириллицы «ООО» в конце строки НЕ образует
 * границу слова, поэтому «ГРИНФИТО ООО» давало ключ `гринфито ооо` вместо
 * `гринфито`. Следствие было дорогим: справочник считал такие написания
 * разными поставщиками, и дубли появлялись ровно там, где их искали.
 */
export function normalizeSupplierName(raw: string): string {
  return supplierNameKey(raw);
}

/** Идентификатор для новой записи: латиница и цифры, стабильный и читаемый. */
export function slugify(value: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  };

  const slug = value
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return slug || `sup-${Date.now().toString(36)}`;
}

/**
 * Имя для человека из «сырого» написания: «ГРИНФИТО ООО» → «Гринфито»,
 * «ЛБренд Кавказский травник (ист1» → «ЛБренд Кавказский травник».
 * Так новый поставщик из накладной не появляется в справочнике капсом.
 *
 * Делегирует в `cleanSupplierName`: одна реализация чистки на весь проект,
 * иначе экран накладной и сохранение в базу давали бы разные имена.
 */
export function prettifySupplierName(raw: string): string {
  return cleanSupplierName(raw);
}

/** Индекс «написание → запись справочника». Строится один раз на список. */
export type SupplierIndex = Map<string, Supplier>;

export function buildSupplierIndex(suppliers: readonly Supplier[]): SupplierIndex {
  const index: SupplierIndex = new Map();

  // Первая запись побеждает: так «Гринфито» не перебивается случайным алиасом.
  for (const supplier of suppliers) {
    for (const key of [supplier.name, ...supplier.aliases]) {
      const normalized = normalizeSupplierName(key);
      if (normalized && !index.has(normalized)) index.set(normalized, supplier);
    }
  }

  return index;
}

/** Запись справочника для «сырого» названия; null — поставщик неизвестен. */
export function findSupplier(index: SupplierIndex, raw: string): Supplier | null {
  return index.get(normalizeSupplierName(raw)) ?? null;
}

/**
 * Поставщик, которого нет в справочнике: позиция не привязана ни к одной
 * активной записи. Показываем её как «Без поставщика», а не «сырым» именем
 * из накладной — иначе список фильтра снова наполняется юрлицами.
 */
export const NO_SUPPLIER_LABEL = "Без поставщика";

/** Знакомо ли справочнику это написание (пустое — да: это не «сырое» имя). */
export function isSupplierKnown(index: SupplierIndex, raw: string): boolean {
  if (raw.trim() === "") return true;
  return findSupplier(index, raw) !== null;
}

/** Что показывать человеку вместо «ГРИНФИТО ООО». */
export function supplierDisplayName(index: SupplierIndex, raw: string): string {
  return findSupplier(index, raw)?.name ?? prettifySupplierName(raw);
}

/** Цвет плашки; у неизвестного поставщика — нейтральный серый. */
export function supplierColor(index: SupplierIndex, raw: string): string {
  return findSupplier(index, raw)?.color ?? UNKNOWN_SUPPLIER_COLOR;
}

/**
 * Вкладки и фильтры: только активные записи, скрытые уходят в конец списка
 * справочника, но вкладки не получают.
 */
export function activeSuppliers(suppliers: readonly Supplier[]): Supplier[] {
  return suppliers.filter((supplier) => !supplier.hidden).sort(compareSuppliers);
}

/** Порядок в справочнике: сначала активные, внутри — по `order`, затем по имени. */
export function compareSuppliers(a: Supplier, b: Supplier): number {
  if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
  if (a.order !== b.order) return a.order - b.order;
  return a.name.localeCompare(b.name, "ru");
}

/** Следующий свободный цвет палитры: он же — «цвет по кругу» для новых записей. */
export function nextSupplierColor(suppliers: readonly Supplier[]): string {
  const used = new Set(suppliers.map((supplier) => supplier.color.toLowerCase()));
  return SUPPLIER_PALETTE.find((color) => !used.has(color.toLowerCase())) ?? SUPPLIER_PALETTE[0];
}

/** Следующая позиция в списке — новый поставщик встаёт в конец. */
export function nextSupplierOrder(suppliers: readonly Supplier[]): number {
  const max = suppliers.reduce((acc, supplier) => Math.max(acc, supplier.order), 0);
  return max + 10;
}

/** Имя занято? Проверяем и название, и алиасы — иначе вкладки задвоятся. */
export function isSupplierNameTaken(
  suppliers: readonly Supplier[],
  name: string,
  exceptId?: string,
): boolean {
  const needle = normalizeSupplierName(name);
  if (!needle) return false;

  return suppliers.some(
    (supplier) =>
      supplier.id !== exceptId &&
      [supplier.name, ...supplier.aliases].some((value) => normalizeSupplierName(value) === needle),
  );
}

/**
 * Ключ для поиска похожих названий: первые 3–4 значимых слова без
 * организационно-правовых форм и кавычек. «Две Линии» и
 * «ООО "ПКФ "ДВЕ ЛИНИИ"» дают `две линии` и совпадают.
 */
function similarityKey(name: string, words: number): string {
  return normalizeSupplierName(name)
    .split(" ")
    .filter(Boolean)
    .filter((word) => !/^(пкф|пко|фирма|компания|торговый|дом)$/.test(word))
    .slice(0, words)
    .join(" ");
}

/**
 * Похожие поставщики для подсказки «Объединить?».
 *
 * Порог: совпадают первые 3–4 слова ИЛИ один ключ — подстрокой другого
 * (отличается только хвост вроде «ООО»/«ПКФ»). Пустые/короткие имена не
 * предлагаем, иначе «Риф» подскажет «Риф и Ко» и наоборот без разбора.
 */
export interface SupplierSuggestion {
  a: Supplier;
  b: Supplier;
  reason: string;
}

export function findSimilarSuppliers(suppliers: readonly Supplier[]): SupplierSuggestion[] {
  const active = activeSuppliers(suppliers);
  const result: SupplierSuggestion[] = [];

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      const reason = similarReason(a.name, b.name);

      if (reason) result.push({ a, b, reason });
    }
  }

  return result;
}

/**
 * То же сравнение, но для одной пары — его использует выпадающий список
 * «Новый поставщик» в диалоге объединения.
 *
 * Возвращает причину совпадения или null. Тот же порог, что у подсказок:
 * первые 4 значимых слова одного укладываются в другие ЛИБО первые 3 равны.
 * Имена короче 6 символов после чистки не сравниваются — иначе «Риф» и
 * «Рифм» слиплись бы.
 */
export function similarReason(a: string, b: string): string | null {
  const a4 = similarityKey(a, 4);
  const b4 = similarityKey(b, 4);
  const a3 = similarityKey(a, 3);
  const b3 = similarityKey(b, 3);

  if (a4.length > 8 && b4.length > 8 && (a4.includes(b4) || b4.includes(a4))) {
    return "отличается только окончание";
  }
  if (a3.length >= 6 && a3 === b3) return "совпадают первые слова";
  return null;
}

/**
 * Кандидаты «с кем объединить» для конкретного поставщика.
 *
 * Полное совпадение ключа (`Гринфито` и `ГРИНФИТО ООО`) сюда не попадает как
 * «похожий», а уезжает отдельным полем: такие записи и есть дубль в чистом
 * виде, их ставим первыми.
 */
export interface SupplierMergeCandidates {
  /** Тот же ключ после чистки — фактически уже дубль. */
  exact: Supplier[];
  /** Похожие по названию, но не дубли. */
  similar: Supplier[];
}

export function mergeCandidates(suppliers: readonly Supplier[], sourceId: string): SupplierMergeCandidates {
  const source = suppliers.find((supplier) => supplier.id === sourceId);
  if (!source) return { exact: [], similar: [] };

  const key = supplierNameKey(source.name);
  const exact: Supplier[] = [];
  const similar: Supplier[] = [];

  for (const supplier of activeSuppliers(suppliers)) {
    if (supplier.id === source.id) continue;
    if (key && supplierNameKey(supplier.name) === key) {
      exact.push(supplier);
      continue;
    }
    if (similarReason(source.name, supplier.name)) similar.push(supplier);
  }

  return { exact, similar };
}

/** Архивный поставщик: в фильтрах и на вкладках не показывается. */
export function isArchived(supplier: Supplier): boolean {
  return supplier.hidden;
}

/**
 * Список написаний, которые после слияния указывают на `target`.
 *
 * Старое имя и его алиасы уезжают в алиасы нового: позиция, в которой осталось
 * «ООО "ПКФ "ДВЕ ЛИНИИ"», всё равно находит запись и красится её цветом.
 *
 * Отбрасываем только написания, СОВПАДАЮЩИЕ С ИМЕНЕМ ЦЕЛИ как текст, а не по
 * ключу. Раньше здесь стоял `normalizeSupplierName`, и после того как ключ
 * начал чистить формы юрлица, «Две Линии» и «ПКФ Две Линии» стали одним ключом
 * — оба выпадали, и алиасы оставались пустыми. Разные написания одного
 * поставщика обязаны уцелеть: именно по ним позиции находят запись.
 */
export function mergedAliases(old: Supplier, target: Supplier): string[] {
  const values = [old.name, ...old.aliases, target.name, ...target.aliases];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].filter(
    (value) => !sameSpelling(value, target.name),
  );
}
