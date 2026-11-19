import { db } from "./db";
import { isInStock, type ShelfItem, type Supplier } from "./types";
import { planSupplierLinks, type SupplierLinkPlan } from "./supplier-links";
import { NO_SUPPLIER_LABEL, mergedAliases, normalizeSupplierName } from "@/domain/suppliers";
import { cleanSupplierName, sameSpelling, supplierNameKey } from "@/domain/supplier-name";

/**
 * Операции справочника поставщиков.
 *
 * Позиция журнала помнит отображаемое написание поставщика (`ShelfItem.supplier`)
 * и ссылку на запись справочника (`ShelfItem.supplierId`). Пока привязки нет,
 * запись находится по имени и алиасам при каждом чтении. После миграции у всех
 * позиций есть supplierId, и переименование поставщика обновляет `supplier`
 * у связанных позиций — иначе они «потеряли» бы поставщика в фильтрах.
 */

function nowISO(): string {
  return new Date().toISOString();
}

export async function listSuppliers(): Promise<Supplier[]> {
  return db.suppliers.toArray();
}

/**
 * Сохранить запись справочника — единственный путь правки поставщика.
 *
 * Если имя меняется, это переименование: старое имя уезжает в алиасы (по нему
 * находят запись позиции, ещё не получившие supplierId), а у всех связанных
 * позиций (по `supplierId`) обновляется отображаемое `supplier`. Позиции без
 * supplierId, но с прежним написанием, подхватываются заодно.
 */
export async function putSupplier(supplier: Supplier): Promise<void> {
  await db.transaction("rw", db.items, db.suppliers, async () => {
    const previous = await db.suppliers.get(supplier.id);
    const stamp = nowISO();
    const renamed = previous !== undefined && !sameSpelling(previous.name, supplier.name);

    const aliases = renamed
      ? [...new Set([...supplier.aliases, previous.name])].filter(
          (alias) => !sameSpelling(alias, supplier.name),
        )
      : supplier.aliases;

    await db.suppliers.put({ ...supplier, aliases, updatedAt: stamp });
    if (!renamed) return;

    const oldKeys = new Set([previous.name, ...previous.aliases].map(normalizeSupplierName));
    const affected = (await db.items.toArray()).filter(
      (item) =>
        item.supplierId === supplier.id ||
        (item.supplierId == null && oldKeys.has(normalizeSupplierName(item.supplier))),
    );

    if (affected.length > 0) {
      await db.items.bulkPut(
        affected.map((item) => ({
          ...item,
          supplier: supplier.name,
          supplierId: supplier.id,
          // excelSheet — исходный лист книги: в журнале он подписан именем
          // поставщика, и после переименования должен читаться так же, иначе
          // карточка показывает «Из журнала: лист «старое имя»».
          excelSheet: item.excelSheet ? supplier.name : item.excelSheet,
          updatedAt: stamp,
        })),
      );
    }
  });
}

/**
 * Разовая накатка привязки позиций к справочнику.
 *
 * Идемпотентна: на уже связанных данных ничего не создаёт и не меняет.
 * Возвращает счётчики — их показывает миграция и отчёт накатки.
 */
export async function linkItemsToSuppliers(): Promise<SupplierLinkPlan> {
  return db.transaction("rw", db.items, db.suppliers, async () => {
    const suppliers = await db.suppliers.toArray();
    const items = await db.items.toArray();
    const plan = planSupplierLinks(items, suppliers, nowISO());
    if (plan.newSuppliers.length > 0) await db.suppliers.bulkPut(plan.newSuppliers);
    await db.items.bulkPut(plan.items);
    return plan;
  });
}

export async function addSupplier(
  draft: Pick<Supplier, "name" | "color" | "aliases" | "hidden" | "order">,
): Promise<Supplier> {
  const supplier: Supplier = {
    ...draft,
    id: `sup-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  await db.suppliers.add(supplier);
  return supplier;
}

export async function removeSupplier(id: string): Promise<void> {
  await db.suppliers.delete(id);
}

/**
 * Сколько позиций поставщика сейчас в наличии.
 *
 * Считаем по имени и алиасам: у позиций, заведённых до переименования, в
 * `supplier` может стоять прежнее написание — оно лежит в алиасах.
 */
export async function countInStock(supplier: Supplier): Promise<number> {
  const seen = new Set<string>();
  let count = 0;

  for (const name of [supplier.name, ...supplier.aliases]) {
    const items: ShelfItem[] = await db.items.where("supplier").equals(name).toArray();
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (isInStock(item)) count += 1;
    }
  }

  return count;
}

/**
 * Объединить двух поставщиков: все товары (включая проданные и списанные)
 * переходят к `targetId`, исходная запись архивируется (`hidden: true`) и
 * остаётся алиасом — история и старые написания не теряются.
 *
 * Одна транзакция на обе таблицы: либо переносятся позиции и архивируется
 * запись, либо ничего не меняется.
 */
export async function mergeSuppliers(oldId: string, targetId: string): Promise<void> {
  if (oldId === targetId) throw new Error("Нельзя объединить поставщика с самим собой");

  await db.transaction("rw", db.items, db.suppliers, async () => {
    const [old, target] = await Promise.all([
      db.suppliers.get(oldId),
      db.suppliers.get(targetId),
    ]);
    if (!old || !target) throw new Error("Поставщик не найден");

    const stamp = nowISO();
    const aliases = mergedAliases(old, target);
    const oldNames = new Set([old.name, ...old.aliases].map(normalizeSupplierName));

    // Переносим ВСЕ позиции, не только в наличии: проданные и списанные
    // тоже должны оказаться у нового поставщика в архиве и отчётах.
    //
    // excelSheet — откуда строка пришла (лист исходного Excel). После слияния
    // он тоже переезжает на имя целевого поставщика, иначе выгрузка разложит
    // позиции по старому листу, которого в справочнике уже нет.
    const items: ShelfItem[] = await db.items.toArray();
    const moved = items.filter((item) => oldNames.has(normalizeSupplierName(item.supplier)));
    await db.items.bulkPut(
      moved.map((item) => ({
        ...item,
        supplier: target.name,
        excelSheet: target.name,
        supplierId: target.id,
        updatedAt: stamp,
      })),
    );

    await db.suppliers.put({ ...target, aliases, updatedAt: stamp });
    await db.suppliers.put({
      ...old,
      aliases: [old.name, ...old.aliases],
      hidden: true,
      updatedAt: stamp,
    });
  });
}

/** Что сделало удаление поставщика: сколько позиций осталось бы без хозяина. */
export interface DeleteSupplierResult {
  /** Сколько позиций было привязано к удалённому поставщику. */
  moved: number;
  /** Кому они достались; `null` — поставщик снят, позиции стали «Без поставщика». */
  targetName: string | null;
}

/**
 * Удалить поставщика, перенеся его товары на другого.
 *
 * Удалять запись, под которой лежат товары, молча нельзя: позиции остались бы
 * с `supplierId`, указывающим в никуда, и выпадали бы из фильтров и вкладок.
 * Поэтому товары (все — и в наличии, и проданные, и списанные) сначала
 * переезжают к `targetId`, и только потом запись исчезает.
 *
 * `targetId === null` — товары осознанно оставляем без поставщика: их
 * `supplier` пустеет. Это допустимо, только когда переносить некуда (в
 * справочнике остаётся одна запись), и вызывающая сторона обязана предупредить.
 *
 * Одна транзакция на обе таблицы: либо перенос и удаление вместе, либо ничего.
 */
export async function deleteSupplier(
  id: string,
  targetId: string | null,
): Promise<DeleteSupplierResult> {
  if (targetId === id) throw new Error("Нельзя перенести товары на удаляемого поставщика");

  return db.transaction("rw", db.items, db.suppliers, async () => {
    const supplier = await db.suppliers.get(id);
    if (!supplier) throw new Error("Поставщик не найден");

    const stamp = nowISO();
    const target = targetId === null ? null : await db.suppliers.get(targetId);
    if (targetId !== null && !target) throw new Error("Поставщик для переноса не найден");

    // Ищем по supplierId, а также по имени и алиасам: у позиций из старого
    // импорта привязки может не быть, но принадлежность от этого не меняется.
    const keys = new Set([supplier.name, ...supplier.aliases].map(normalizeSupplierName));
    const affected = (await db.items.toArray()).filter(
      (item) =>
        item.supplierId === id ||
        (item.supplierId == null && keys.has(normalizeSupplierName(item.supplier))),
    );

    if (affected.length > 0) {
      await db.items.bulkPut(
        affected.map((item) =>
          target
            ? {
                ...item,
                supplier: target.name,
                // excelSheet — раскладка выгрузки по листам: лист удалённой
                // записи в книге остаться не может, иначе появится «пустой»
                // лист с именем поставщика, которого больше нет.
                excelSheet: target.name,
                supplierId: target.id,
                updatedAt: stamp,
              }
            : {
                ...item,
                supplier: NO_SUPPLIER_LABEL,
                supplierId: null,
                excelSheet: null,
                updatedAt: stamp,
              },
        ),
      );
    }

    await db.suppliers.delete(id);
    return { moved: affected.length, targetName: target?.name ?? null };
  });
}

/**
 * Архивировать поставщика без товаров в наличии. Проданные/списанные позиции
 * остаются при Writable-записи и просто продолжают показываться в архиве.
 */
export async function archiveSupplier(id: string): Promise<void> {
  await db.transaction("rw", db.items, db.suppliers, async () => {
    const supplier = await db.suppliers.get(id);
    if (!supplier) throw new Error("Поставщик не найден");
    if (await countInStock(supplier)) {
      throw new Error("У этого поставщика есть товары в наличии");
    }
    await db.suppliers.put({ ...supplier, hidden: true, updatedAt: nowISO() });
  });
}

/** Что сделала очистка: сколько было, сколько стало и что именно изменилось. */
export interface CleanResult {
  /** Сколько записей было до очистки. */
  before: number;
  /** Сколько стало после объединения дублей. */
  after: number;
  /** Сколько записей справочника переименовано. */
  renamed: number;
  /** Сколько записей позиций переписано на чистое имя. */
  itemsTouched: number;
  /** Какие записи ушли в архив как дубли. */
  merged: Array<{ from: string; into: string }>;
}

/**
 * Приводит все имена поставщиков к ядру и схлопывает появившиеся дубли.
 *
 * Зачем это нужно. Имя поставщика приходит из трёх источников и выглядит
 * по-разному: лист Excel — «ГРИНФИТО ООО», накладная — «Общество с ограниченной
 * ответственностью "РИФ И КО", ИНН …, адрес …». Раньше такие написания заводили
 * отдельные записи справочника: на вкладках и в фильтрах один поставщик
 * появлялся по два-три раза.
 *
 * Что делает:
 *   1) каждому имени в справочнике считает `cleanSupplierName`;
 *   2) переписывает на чистое имя все позиции, ссылавшиеся на грязное написание;
 *   3) записи с одинаковым ключом сливает в одну — с наибольшим числом позиций,
 *      чтобы уцелевшая запись не потеряла цвет и порядок вкладок;
 *   4) остальные уводит в архив с чистым именем в алиасах: позиции и история
 *      остаются на месте, а старая форма написания продолжает находить запись.
 *
 * Одна транзакция на обе таблицы: упав на середине, очистка ничего не оставит
 * в половинчатом состоянии. Повторный запуск безопасен — он ничего не найдёт.
 */
export async function cleanSupplierNames(): Promise<CleanResult> {
  return db.transaction("rw", db.items, db.suppliers, async () => {
    const suppliers = await db.suppliers.toArray();
    const items = await db.items.toArray();
    const stamp = nowISO();
    const before = suppliers.filter((supplier) => !supplier.hidden).length;

    // 1. Каждой записи — чистое имя и ключ, по которому ищем двойников.
    const cleaned = suppliers.map((supplier) => {
      const name = cleanSupplierName(supplier.name) || supplier.name;
      return { supplier, name, key: supplierNameKey(name) };
    });

    // 2. Группируем по ключу. Порядок групп — по первой встрече, он же порядок
    //    записей справочника, чтобы вкладки на экране не перетасовались.
    const groups = new Map<string, typeof cleaned>();
    for (const entry of cleaned) {
      const list = groups.get(entry.key);
      if (list) list.push(entry);
      else groups.set(entry.key, [entry]);
    }

    // 3. Сколько позиций стоит за каждой записью: по ним выбираем главную.
    const itemCounts = new Map<string, number>();
    for (const item of items) {
      const key = supplierNameKey(item.supplier);
      itemCounts.set(key, (itemCounts.get(key) ?? 0) + 1);
    }

    const merged: Array<{ from: string; into: string }> = [];
    const updates: Supplier[] = [];

    for (const list of groups.values()) {
      // Одиночную уже чистую запись не трогаем вовсе: иначе очистка «без
      // изменений» переписывала бы updatedAt у всего справочника.
      if (
        list.length === 1 &&
        list[0].name === list[0].supplier.name &&
        list[0].supplier.aliases.every((alias) => !sameSpelling(alias, list[0].name))
      ) {
        continue;
      }

      // Главная — активная запись, чьё имя уже равно чистому: она и должна
      // выжить, чтобы не потерять цвет и место во вкладках. Если такой нет —
      // активная с наибольшим числом позиций, иначе просто первая.
      const active = list.filter((entry) => !entry.supplier.hidden);
      const pool = active.length > 0 ? active : list;
      const alreadyClean = pool.filter((entry) => sameSpelling(entry.name, entry.supplier.name));
      const primary =
        (alreadyClean.length > 0 ? alreadyClean : pool)
          .slice()
          .sort(
            (a, b) =>
              (itemCounts.get(b.key) ?? 0) - (itemCounts.get(a.key) ?? 0) ||
              b.supplier.aliases.length - a.supplier.aliases.length,
          )[0];

      for (const entry of list) {
        if (entry.supplier.id === primary.supplier.id) continue;

        // Архивные записи не «воскрешаем»: их архивировал человек. Единственное,
        // что делаем — приводим имя к чистому, чтобы архив читался.
        if (entry.supplier.hidden) {
          if (entry.name !== entry.supplier.name) {
            updates.push({ ...entry.supplier, name: entry.name, updatedAt: stamp });
          }
          continue;
        }

        // Активный двойник: фиксируем его для отчёта и уводим в архив.
        if (!sameSpelling(entry.name, primary.name)) {
          merged.push({ from: entry.supplier.name, into: primary.name });
        }
        updates.push({
          ...entry.supplier,
          name: entry.name,
          aliases: [...new Set([...entry.supplier.aliases, entry.name])].filter(
            (alias) => !sameSpelling(alias, primary.name),
          ),
          hidden: true,
          updatedAt: stamp,
        });
      }

      // Главная запись получает чистое имя и вбирает написания дублей.
      const aliases = primary.supplier.aliases.slice();
      for (const entry of list) {
        if (entry.supplier.id === primary.supplier.id) continue;
        aliases.push(entry.supplier.name, entry.name);
      }

      updates.push({
        ...primary.supplier,
        name: primary.name,
        aliases: [...new Set(aliases)].filter((alias) => !sameSpelling(alias, primary.name)),
        updatedAt: stamp,
      });
    }

    // 4. Позиции: имя поставщика переписываем на чистое.
    let itemsTouched = 0;
    const changed: ShelfItem[] = [];
    for (const item of items) {
      const clean = cleanSupplierName(item.supplier);
      // `!clean` — имя целиком из реквизитов; такое оставляем как есть, иначе
      // позиция потеряет привязку к поставщику совсем.
      if (!clean) continue;
      // Сравниваем как написания, а не по символам: «Две  линии » и «Две линии»
      // это одно имя, и трогать его незачем.
      if (sameSpelling(clean, item.supplier)) continue;
      itemsTouched += 1;
      changed.push({ ...item, supplier: clean, updatedAt: stamp });
    }

    if (updates.length > 0) await db.suppliers.bulkPut(updates);

    // Позиции пересобираем целиком и заново привязываем к справочнику:
    // переименование или слияние должно отразиться и на supplierId.
    const finalSuppliers = suppliers.map(
      (supplier) => updates.find((update) => update.id === supplier.id) ?? supplier,
    );
    const changedById = new Map(changed.map((entry) => [entry.id, entry]));
    const finalItems = items.map((item) => changedById.get(item.id) ?? item);
    const plan = planSupplierLinks(finalItems, finalSuppliers, stamp);
    if (plan.newSuppliers.length > 0) await db.suppliers.bulkPut(plan.newSuppliers);
    await db.items.bulkPut(plan.items);

    // После слияния активных записей стало меньше; архивные не считаем.
    const after = (
      await db.suppliers.toArray()
    ).filter((supplier) => !supplier.hidden).length;

    const renamed = updates.filter((supplier) => {
      const was = suppliers.find((old) => old.id === supplier.id);
      return was !== undefined && !supplier.hidden && was.name !== supplier.name;
    }).length;

    return {
      before,
      after,
      renamed,
      itemsTouched,
      merged: merged.filter((entry) => !sameSpelling(entry.from, entry.into)),
    };
  });
}
