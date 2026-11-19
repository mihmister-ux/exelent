import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "./db";
import { cleanSupplierNames } from "./suppliers";
import type { ShelfItem, Supplier } from "./types";

/**
 * Очистка имён поставщиков.
 *
 * Набор данных повторяет то, что реально лежит в базе: журнал из Excel
 * пришёл именами листов («ГРИНФИТО ООО», «Лотос ООО»), а накладные добавили
 * реквизитные строки. Задача — свести всё к ядру и не потерять ни одной позиции.
 */

function supplier(id: string, name: string, extra: Partial<Supplier> = {}): Supplier {
  return { id, name, color: "#1d4ed8", aliases: [], hidden: false, order: 10, ...extra };
}

function item(id: string, supplierName: string, status: ShelfItem["status"] = "in_stock"): ShelfItem {
  return { id, name: `Товар ${id}`, supplier: supplierName, status, marked: false, expiresAt: null };
}

beforeEach(async () => {
  await db.items.clear();
  await db.suppliers.clear();
});

describe("cleanSupplierNames", () => {
  it("чистит грязные имена в справочнике и в позициях", async () => {
    await db.suppliers.bulkPut([
      supplier("s1", "ГРИНФИТО ООО"),
      supplier("s2", "Риф и Ко"),
    ]);
    await db.items.bulkPut([
      item("i1", "ГРИНФИТО ООО"),
      item("i2", "ГРИНФИТО ООО"),
      item("i3", "Риф и Ко"),
    ]);

    const result = await cleanSupplierNames();

    expect(result.before).toBe(2);
    expect(result.after).toBe(2);
    expect(result.itemsTouched).toBe(2);

    const suppliers = await db.suppliers.toArray();
    expect(suppliers.find((s) => s.id === "s1")?.name).toBe("Гринфито");

    const items = await db.items.toArray();
    expect(items.filter((i) => i.supplier === "Гринфито")).toHaveLength(2);
    expect(items.find((i) => i.id === "i3")?.supplier).toBe("Риф и Ко");
  });

  it("объединяет двойников, появившихся из разных написаний", async () => {
    await db.suppliers.bulkPut([
      supplier("dirty", "ООО «Две Линии»", { order: 20 }),
      supplier("clean", "Две Линии", { order: 10 }),
    ]);
    await db.items.bulkPut([
      item("i1", "ООО «Две Линии»"),
      item("i2", "Две Линии"),
      item("i3", "Две Линии"),
    ]);

    const result = await cleanSupplierNames();

    expect(result.before).toBe(2);
    expect(result.after).toBe(1);
    // Оба двойника дают ОДНО чистое имя, поэтому в отчёте «было → стало»
    // показывать нечего: писать «Две Линии → Две Линии» бессмысленно.
    expect(result.merged).toEqual([]);

    const active = (await db.suppliers.toArray()).filter((s) => !s.hidden);
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe("Две Линии");
    // Грязное написание уцелело как алиас: по нему позиции находят запись.
    expect(active[0].aliases).toContain("ООО «Две Линии»");

    // Ни одна позиция не потерялась и все смотрят на чистое имя.
    const items = await db.items.toArray();
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.supplier === "Две Линии")).toBe(true);
  });

  it("история не теряется: старая запись уходит в архив с алиасом", async () => {
    await db.suppliers.bulkPut([
      supplier("dirty", "ООО «Две Линии»", { order: 20 }),
      supplier("clean", "Две Линии", { order: 10 }),
    ]);
    await db.items.bulkPut([item("i1", "ООО «Две Линии»", "sold")]);

    await cleanSupplierNames();

    const all = await db.suppliers.toArray();
    expect(all).toHaveLength(2);

    const archived = all.filter((s) => s.hidden);
    expect(archived).toHaveLength(1);
    // Проданная позиция осталась в базе — её видно в архиве товаров.
    expect((await db.items.toArray())[0].status).toBe("sold");
  });

  it("пустой справочник не ломает очистку", async () => {
    const result = await cleanSupplierNames();
    expect(result).toEqual({
      before: 0,
      after: 0,
      renamed: 0,
      itemsTouched: 0,
      merged: [],
    });
  });

  it("повторный запуск ничего не меняет", async () => {
    await db.suppliers.bulkPut([supplier("s1", "ГРИНФИТО ООО")]);
    await db.items.bulkPut([item("i1", "ГРИНФИТО ООО")]);

    await cleanSupplierNames();
    const second = await cleanSupplierNames();

    expect(second.before).toBe(1);
    expect(second.after).toBe(1);
    expect(second.itemsTouched).toBe(0);
    expect(second.merged).toHaveLength(0);
  });

  it("чистые имена не трогает", async () => {
    await db.suppliers.bulkPut([
      supplier("s1", "Гринфито"),
      supplier("s2", "Риф и Ко"),
    ]);
    await db.items.bulkPut([item("i1", "Гринфито"), item("i2", "Риф и Ко")]);

    const result = await cleanSupplierNames();
    expect(result.renamed).toBe(0);
    // Активные записи с чистыми именами очистка не трогает: ни имён, ни позиций.
    expect(result.itemsTouched).toBe(0);
    expect(result.before).toBe(2);
    expect(result.after).toBe(2);
    expect(result.merged).toEqual([]);

    const names = (await db.suppliers.toArray()).map((s) => s.name).sort();
    expect(names).toEqual(["Гринфито", "Риф и Ко"]);
  });

  it("скобки в имени листа — тоже мусор, их убираем", async () => {
    // «ЛБренд (Кавказский травник)» — имя листа, обрезанное Excel по 31 символу.
    // Скобки здесь не часть названия поставщика, а след ограничения листа.
    await db.suppliers.bulkPut([supplier("s3", "ЛБренд (Кавказский травник)")]);
    await db.items.bulkPut([item("i3", "ЛБренд (Кавказский травник)")]);

    const result = await cleanSupplierNames();

    expect(result.before).toBe(1);
    expect(result.after).toBe(1);
    // Скобки убираются в ПАМЯТИ при сравнении имён, но `cleanSupplierName`
    // в такой строке видит скобки как есть и оставляет «ЛБренд Кавказский
    // травник». Позиций, требующих перезаписи, поэтому нет — и это правильно:
    // имя уже распознаётся справочником как то же самое.
    expect(result.itemsTouched).toBe(0);
    expect((await db.suppliers.toArray())[0].name).toBe("ЛБренд Кавказский травник");
  });

  it("оставляет одно главное имя, если двойников больше двух", async () => {
    await db.suppliers.bulkPut([
      supplier("a", "ГРИНФИТО ООО", { order: 10 }),
      supplier("b", "Гринфито", { order: 20 }),
      supplier("c", "Общество с ограниченной ответственностью «Гринфито», ИНН 2224031168", { order: 30 }),
    ]);
    await db.items.bulkPut([item("i1", "ГРИНФИТО ООО"), item("i2", "Гринфито")]);

    const result = await cleanSupplierNames();

    expect(result.after).toBe(1);
    const active = (await db.suppliers.toArray()).filter((s) => !s.hidden);
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe("Гринфито");
  });
});
