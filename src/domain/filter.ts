import type { ShelfItem, Supplier } from "@/db/types";
import {
  activeSuppliers,
  buildSupplierIndex,
  defaultSuppliers,
  findSupplier,
  isSupplierKnown,
} from "@/domain/suppliers";

export const ALL_SUPPLIERS = "all";

/**
 * Значение фильтра «Без поставщика»: позиции, чьё написание не сводится ни к
 * одной активной записи справочника (те самые «сырые» имена из накладных).
 *
 * Оно же — подпись пункта в выпадающем списке: человек видит понятную причину,
 * а не «ООО "ПКФ "ДВЕ ЛИНИИ", ИНН 2224031168».
 */
export const NO_SUPPLIER = "__no_supplier__";

export interface ShelfFilter {
  query: string;
  supplier: string;
}

export const EMPTY_FILTER: ShelfFilter = { query: "", supplier: ALL_SUPPLIERS };

/** «Ё» и регистр не должны мешать поиску: склад ищет «елка» и «Ёлка» одинаково. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function matchesQuery(item: ShelfItem, query: string): boolean {
  const needle = normalize(query);
  if (!needle) return true;

  const haystack = normalize(
    [item.name, item.supplier, item.rawExpires ?? "", item.note ?? ""].join(" "),
  );
  // Каждое слово запроса должно найтись — «зайчик риф» тоже сработает.
  return needle.split(" ").every((part) => haystack.includes(part));
}

export function filterItems(
  items: ShelfItem[],
  filter: ShelfFilter,
  directory: readonly Supplier[] = [],
): ShelfItem[] {
  // Пустой справочник — не «все имена неизвестны»: до загрузки базы список
  // поставщиков строится по встроенному справочнику, и фильтр обязан с ним
  // согласовываться, иначе сразу после открытия он показывает пустоту.
  const index = buildSupplierIndex(directory.length > 0 ? directory : defaultSuppliers());
  return items.filter((item) => {
    if (filter.supplier !== ALL_SUPPLIERS) {
      /*
        Сравниваем не по написанию из позиции, а по записи справочника: после
        объединения «ООО "ПКФ "ДВЕ ЛИНИИ"» и «Две Линии» это один поставщик, и
        выбор «Две Линии» обязан показать обе партии. Позиция с написанием, о
        котором справочник не знает, попадает в отдельную группу «Без поставщика».

        Пустое написание считаем известным — иначе пункт «Без поставщика»
        собирал бы позиции, у которых поставщик не заполнен вовсе, и человек
        не понял бы, откуда они взялись.
      */
      const selected = findSupplier(index, filter.supplier)?.name ?? filter.supplier;
      const entry = isSupplierKnown(index, item.supplier) ? findSupplier(index, item.supplier)?.name : undefined;
      if ((entry ?? NO_SUPPLIER) !== selected) return false;
    }
    return matchesQuery(item, filter.query);
  });
}

/**
 * Есть ли в журнале написания, которых нет в справочнике.
 *
 * Нужно, чтобы фильтр не делал вид, что такие позиции «потерялись»: они
 * собраны в одной группе, и о ней надо сказать человеку.
 */
export function unknownSupplierCount(items: ShelfItem[], directory: readonly Supplier[]): number {
  const index = buildSupplierIndex(directory.length > 0 ? directory : defaultSuppliers());
  return items.filter((item) => !isSupplierKnown(index, item.supplier)).length;
}

/**
 * Список поставщиков для фильтра.
 *
 * Берём из справочника активные записи (в порядке вкладок) — это единственный
 * источник «чистых» имён. «Сырые» написания из позиций (полные юрлица с ИНН,
 * адресом и кавычками) в список не попадают вовсе: они либо сводятся к записи
 * справочника, либо уходят в общий пункт «Без поставщика». Иначе после
 * объединения в списке снова появлялись бы оба варианта: позиции помнят старое
 * написание, и оно просачивалось в options.
 *
 * «Без поставщика» стоит последним пунктом и только когда такие позиции есть:
 * пустой пункт в списке — лишний шум.
 */
export function supplierOptions(
  items: ShelfItem[],
  directory: readonly Supplier[] = [],
): string[] {
  const result = activeSuppliers(directory).map((supplier) => supplier.name);

  // «Без поставщика» — последним пунктом и только когда такие позиции реально есть.
  if (unknownSupplierCount(items, directory) > 0) result.push(NO_SUPPLIER);

  return result;
}
