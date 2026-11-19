import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { addItem, addItems } from "./repo";
import type { ShelfItem, ShelfItemDraft, Supplier } from "./types";

/**
 * Тесты на запись в журнал. Needed fake-indexeddb: в браузере Dexie живёт на
 * IndexedDB, в Node его нет. Отдельный файл — чтобы не тащить polyfill во
 * все доменные тесты.
 *
 * Ключевой сценарий: та же партия (поставщик + название + срок) не должна
 * завестись второй раз ни руками, ни импортом; другая дата срока — новая
 * партия и проходит.
 */

function draft(
  name: string,
  supplier: string,
  expiresAt: string | null,
  receivedAt: string | null = null,
): ShelfItemDraft {
  return {
    name,
    supplier,
    expiresAt,
    receivedAt,
    marked: false,
    status: "in_stock",
    source: "manual",
  };
}

async function rows(): Promise<ShelfItem[]> {
  return db.items.toArray();
}

beforeEach(async () => {
  await db.items.clear();
  await db.suppliers.clear();
});

describe("addItem — ручное добавление", () => {
  it("первую позицию записывает и возвращает id", async () => {
    const id = await addItem(draft("Чай", "Лотос", "2027-01-15"));
    expect(id).toBeTruthy();
    expect(await rows()).toHaveLength(1);
  });

  it("тот же товар того же поставщика с тем же сроком — дубль, id не выдаётся", async () => {
    await addItem(draft("Чай", "Лотос", "2027-01-15"));
    const second = await addItem(draft("Чай", "Лотос", "2027-01-15"));
    expect(second).toBeNull();
    expect(await rows()).toHaveLength(1);
  });

  it("тот же товар с другим сроком — новая партия, записывается", async () => {
    await addItem(draft("Чай", "Лотос", "2027-01-15"));
    const second = await addItem(draft("Чай", "Лотос", "2027-06-01"));
    expect(second).toBeTruthy();
    expect(await rows()).toHaveLength(2);
  });

  it(".registered: регистр и пробелы в названии не создают дубль", async () => {
    await addItem(draft("Чай зелёный", "Лотос", "2027-01-15"));
    const second = await addItem(draft("  чай   зеленый  ", "Лотос", "2027-01-15"));
    expect(second).toBeNull();
  });

  it("проданная позиция не мешает завести ту же партию заново", async () => {
    const id = await addItem(draft("Чай", "Лотос", "2027-01-15"));
    expect(id).toBeTruthy();
    if (!id) throw new Error("ожидали id");
    await db.items.update(id, { status: "sold" });
    const again = await addItem(draft("Чай", "Лотос", "2027-01-15"));
    expect(again).toBeTruthy();
    expect(await rows()).toHaveLength(2);
  });
});

describe("addItems — импорт накладной", () => {
  it("повтор того же товара с тем же сроком пропускается и попадает в список", async () => {
    await addItems([draft("Чай", "Лотос", "2027-01-15")]);
    const result = await addItems([draft("Чай", "Лотос", "2027-01-15")]);
    expect(result.ids).toHaveLength(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.skipped).toEqual([
      { name: "Чай", supplier: "Лотос", expiresAt: "2027-01-15" },
    ]);
  });

  it("новый срок той же позиции импортируется, не считается дублем", async () => {
    await addItems([draft("Чай", "Лотос", "2027-01-15")]);
    const result = await addItems([draft("Чай", "Лотос", "2027-06-01")]);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.ids).toHaveLength(1);
    expect(await rows()).toHaveLength(2);
  });

  it("дубль внутри одной накладной берётся только один раз", async () => {
    const result = await addItems([
      draft("Чай", "Лотос", "2027-01-15"),
      draft("Чай", "Лотос", "2027-01-15"),
    ]);
    expect(result.ids).toHaveLength(1);
    expect(result.skippedDuplicates).toBe(1);
  });

  it("тот же товар с тем же сроком, но другой датой поступления — отдельная запись", async () => {
    await addItems([draft("Чай", "Лотос", "2027-01-15", "2026-03-01")]);
    const result = await addItems([draft("Чай", "Лотос", "2027-01-15", "2026-04-10")]);

    expect(result.skippedDuplicates).toBe(0);
    expect(result.ids).toHaveLength(1);

    const saved = await rows();
    expect(saved).toHaveLength(2);
    expect(saved.map((entry) => entry.receivedAt).sort()).toEqual(["2026-03-01", "2026-04-10"]);
  });

  it("повторный импорт с той же датой поступления — дубль, как и раньше", async () => {
    await addItems([draft("Чай", "Лотос", "2027-01-15", "2026-03-01")]);
    const result = await addItems([draft("Чай", "Лотос", "2027-01-15", "2026-03-01")]);

    expect(result.skippedDuplicates).toBe(1);
    expect(result.ids).toHaveLength(0);
    expect(await rows()).toHaveLength(1);
  });
});

describe("addItems — ручной выбор поставщика", () => {
  it("выбранный supplierId записывается, запись в справочнике не дублируется", async () => {
    const lotos: Supplier = {
      id: "sup-lotos",
      name: "Лотос",
      color: "#a16207",
      aliases: ["Лотос ООО"],
      hidden: false,
      order: 10,
    };
    await db.suppliers.add(lotos);

    const result = await addItems([{ ...draft("Чай", "Лотос", "2027-01-15"), supplierId: lotos.id }]);

    expect(result.ids).toHaveLength(1);
    expect((await rows())[0].supplierId).toBe(lotos.id);
    // Авто-создания нет: в справочнике осталась одна запись.
    expect(await db.suppliers.count()).toBe(1);
  });

  it("имя не должно перебивать явный выбор: supplierId главнее сопоставления по строке", async () => {
    const lotos: Supplier = {
      id: "sup-lotos",
      name: "Лотос",
      color: "#a16207",
      aliases: [],
      hidden: false,
      order: 10,
    };
    const other: Supplier = {
      id: "sup-other",
      name: "Лотос",
      color: "#be123c",
      aliases: ["ЛОТОС"],
      hidden: true,
      order: 20,
    };
    await db.suppliers.bulkAdd([lotos, other]);

    // Написание «ЛОТОС» по имени привело бы к первому совпадению; но человек
    // явно выбрал «sup-lotos», и именно эта ссылка обязана сохраниться.
    const result = await addItems([{ ...draft("Чай", "Лотос", "2027-01-15"), supplierId: lotos.id }]);

    expect(result.ids).toHaveLength(1);
    expect((await rows())[0].supplierId).toBe(lotos.id);
    expect(await db.suppliers.count()).toBe(2);
  });
});
