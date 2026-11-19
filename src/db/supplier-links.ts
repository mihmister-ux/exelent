/**
 * Связь позиции с записью справочника поставщиков.
 *
 * До этой правки у позиции было только «сырое» написание поставщика
 * (`supplier`): строка из листа Excel или накладной. Справочник сопоставлял её
 * с записью по имени и алиасам при каждом чтении. Из-за этого ручная привязка
 * была хрупкой: как только имя в справочнике менялось, позиция «теряла»
 * поставщика и уезжала в «Без поставщика».
 *
 * Здесь появляется явная привязка:
 *   supplierId — id записи справочника,
 *
 * а отображаемое написание остаётся в `supplier` (ShelfItem) и при
 * переименовании обновляется отдельной функцией `putSupplier`.
 *
 * Модуль намеренно не тянет Dexie: это чистое преобразование массивов, которое
 * переиспользуют миграция базы, функция накатки и запись позиций.
 */

import { sameSpelling } from "@/domain/supplier-name";
import {
  activeSuppliers,
  buildSupplierIndex,
  findSupplier,
  nextSupplierColor,
  nextSupplierOrder,
  normalizeSupplierName,
  prettifySupplierName,
  slugify,
  type SupplierIndex,
} from "@/domain/suppliers";
import type { ShelfItem, Supplier } from "./types";

/** Что сделала привязка: сколько записей справочника создано и позиций связано. */
export interface SupplierLinkPlan {
  /** Позиции с проставленным supplierId (новый массив, порядок сохранён). */
  items: ShelfItem[];
  /** Записи справочника, которых не было и которые надо создать. */
  newSuppliers: Supplier[];
  /** Сколько записей справочника создано. */
  created: number;
  /** Сколько позиций получило/сменило привязку. */
  linked: number;
}

/**
 * Новая запись справочника под «сырое» написание поставщика.
 *
 * Имя чистим (`ГРИНФИТО ООО` → `Гринфито`), а исходное написание оставляем
 * алиасом, чтобы следующие позиции с тем же текстом находили запись. Цвет —
 * следующий свободный из палитры («по кругу»), порядок — в конец списка.
 */
function createSupplier(raw: string, all: Supplier[], usedIds: Set<string>, now: string): Supplier {
  const name = prettifySupplierName(raw) || raw;
  const base = `sup-${slugify(name)}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }

  return {
    id,
    name,
    color: nextSupplierColor(all),
    aliases: sameSpelling(name, raw) ? [] : [raw],
    hidden: false,
    order: nextSupplierOrder(all),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Считает привязку позиций к справочнику, ничего не записывая.
 *
 * Для каждой позиции с непустым «сырым» именем поставщика:
 *   1) если у позиции уже есть `supplierId` и запись активна — берёт её;
 *   2) иначе ищет запись в справочнике по имени и алиасам;
 *   3) если записи нет — заводит её (цвет по кругу, порядок в конец);
 *   4) проставляет позиции supplierId.
 *
 * Почему явный `supplierId` главнее поиска по имени. При импорте накладной
 * поставщика выбирает человек, и его выбор не должен «переигрываться»
 * сопоставлением строк: имя из списка может совпасть с алиасом другой записи,
 * и позиция молча уехала бы к чужому поставщику. Скрытые (архивные) записи
 * этого права не получают: после объединения и очистки имя уже указывает на
 * уцелевшую запись, и привязка обязана последовать за именем.
 *
 * Отображаемое написание (`supplier`) не переписываем: этим занимается
 * переименование в справочнике. Позиции с пустым поставщиком не трогаем.
 * Функция идемпотентна — повторный проход по уже связанным данным ничего не
 * меняет (created = 0, linked = 0).
 */
export function planSupplierLinks(
  items: readonly ShelfItem[],
  suppliers: readonly Supplier[],
  now: string,
): SupplierLinkPlan {
  // Активные первыми: при одинаковом написании побеждает неархивная запись, а
  // не двойник, уехавший в архив после объединения.
  const ordered = [...activeSuppliers(suppliers), ...suppliers.filter((supplier) => supplier.hidden)];
  const index: SupplierIndex = buildSupplierIndex(ordered);
  const usedIds = new Set(suppliers.map((supplier) => supplier.id));
  const all = [...ordered];
  const activeById = new Map(
    activeSuppliers(suppliers).map((supplier) => [supplier.id, supplier] as const),
  );

  const out: ShelfItem[] = [];
  const newSuppliers: Supplier[] = [];
  let created = 0;
  let linked = 0;

  for (const item of items) {
    const raw = (item.supplier ?? "").trim();
    if (!raw) {
      out.push(item);
      continue;
    }

    // Выбранный человеком поставщик: пока запись активна, её решение окончательно.
    const chosen = item.supplierId ? activeById.get(item.supplierId) : undefined;

    let supplier = chosen ?? findSupplier(index, raw);
    if (!supplier) {
      supplier = createSupplier(raw, all, usedIds, now);
      newSuppliers.push(supplier);
      all.push(supplier);
      usedIds.add(supplier.id);
      created += 1;

      // Сразу кладём созданную запись в индекс: следующая позиция с тем же
      // написанием должна найти именно её, а не завести вторую запись.
      for (const key of [supplier.name, ...supplier.aliases]) {
        const normalized = normalizeSupplierName(key);
        if (normalized && !index.has(normalized)) index.set(normalized, supplier);
      }
    }

    if (item.supplierId === supplier.id) {
      out.push(item);
    } else {
      linked += 1;
      out.push({ ...item, supplierId: supplier.id });
    }
  }

  return { items: out, newSuppliers, created, linked };
}
