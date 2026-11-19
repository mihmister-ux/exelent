import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { defaultSuppliers } from "@/domain/suppliers";
import { seedItems } from "@/data/seedItems";
import { db } from "./db";
import { linkItemsToSuppliers, putSupplier } from "./suppliers";
import type { ShelfItem } from "./types";

/**
 * Привязка позиций к справочнику поставщиков (supplierId) и заполнение
 * receivedAt.
 *
 * Проверяем то, ради чего всё делалось:
 *   1) реальный журнал из 146 строк целиком привязывается к 7 поставщикам;
 *   2) «чужое» написание заводит запись справочника (цвет по кругу, порядок в конец);
 *   3) переименование поставщика обновляет `supplier` у связанных позиций;
 *   4) receivedAt присутствует в типе и заполняется там, где дата есть в источнике.
 */

function item(id: string, supplier: string, status: ShelfItem["status"] = "in_stock"): ShelfItem {
  return { id, name: `Товар ${id}`, supplier, status, marked: false, expiresAt: null };
}

beforeEach(async () => {
  await db.items.clear();
  await db.suppliers.clear();
});

describe("linkItemsToSuppliers", () => {
  it("реальный журнал: все 146 позиций привязываются к 7 поставщикам, новых записей нет", async () => {
    await db.suppliers.bulkPut(defaultSuppliers());
    await db.items.bulkPut(seedItems());

    const result = await linkItemsToSuppliers();
    const items = await db.items.toArray();

    console.log(
      JSON.stringify({
        накатка: {
          записейСправочника: await db.suppliers.count(),
          позиций: items.length,
          созданоПоставщиков: result.created,
          обновленоПозиций: result.linked,
          receivedAtЕсть: items.filter((entry) => entry.receivedAt).length,
          receivedAtПусто: items.filter((entry) => !entry.receivedAt).length,
        },
      }),
    );

    expect(result.created).toBe(0);
    expect(result.linked).toBe(146);
    expect(items).toHaveLength(146);
    expect(items.every((entry) => entry.supplierId)).toBe(true);

    // receivedAt: в источнике дата поступления была заполнена не везде — те
    // строки, где она есть, обязаны её сохранить.
    expect(items.filter((entry) => entry.receivedAt).length).toBeGreaterThan(0);
    expect(
      items.filter((entry) => entry.receivedAt).every((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.receivedAt ?? "")),
    ).toBe(true);
  });

  it("неизвестное написание заводит запись справочника и привязывает позицию", async () => {
    await db.suppliers.bulkPut(defaultSuppliers());
    await db.items.bulkPut([item("i1", "ООО Ромашка, ИНН 2224031168")]);

    const result = await linkItemsToSuppliers();

    expect(result.created).toBe(1);
    expect(result.linked).toBe(1);

    const saved = await db.items.get("i1");
    expect(saved?.supplierId).toBeTruthy();
    const created = await db.suppliers.get(saved?.supplierId ?? "");
    expect(created?.name).toBe("Ромашка");
    expect(created?.aliases).toContain("ООО Ромашка, ИНН 2224031168");
    expect(created?.hidden).toBe(false);
  });

  it("повторный запуск ничего не создаёт и не меняет", async () => {
    await db.suppliers.bulkPut(defaultSuppliers());
    await db.items.bulkPut(seedItems());

    await linkItemsToSuppliers();
    const again = await linkItemsToSuppliers();

    expect(again.created).toBe(0);
    expect(again.linked).toBe(0);
  });
});

describe("putSupplier — переименование", () => {
  it("обновляет supplier у связанных позиций (по supplierId)", async () => {
    const green = defaultSuppliers().find((supplier) => supplier.name === "Гринфито");
    if (!green) throw new Error("в справочнике нет «Гринфито»");

    await db.suppliers.bulkPut(defaultSuppliers());
    await db.items.bulkPut([
      { ...item("i1", "Гринфито"), supplierId: green.id },
      // Позиция до миграции: supplierId ещё нет, подхватываем по написанию.
      item("i2", "ГРИНФИТО ООО"),
    ]);

    await putSupplier({ ...green, name: "Гринфито Плюс" });

    const first = await db.items.get("i1");
    const second = await db.items.get("i2");
    expect(first?.supplierId).toBe(green.id);
    expect(first?.supplier).toBe("Гринфито Плюс");
    expect(second?.supplierId).toBe(green.id);
    expect(second?.supplier).toBe("Гринфито Плюс");

    const saved = await db.suppliers.get(green.id);
    expect(saved?.name).toBe("Гринфито Плюс");
    expect(saved?.aliases).toContain("Гринфито");
    expect(saved?.aliases).toContain("ГРИНФИТО ООО");
  });

  it("не трогает позиции другого поставщика", async () => {
    const green = defaultSuppliers().find((supplier) => supplier.name === "Гринфито");
    if (!green) throw new Error("в справочнике нет «Гринфито»");

    await db.suppliers.bulkPut(defaultSuppliers());
    await db.items.bulkPut([item("i2", "Риф и Ко")]);

    await putSupplier({ ...green, name: "Гринфито Плюс" });

    expect((await db.items.get("i2"))?.supplier).toBe("Риф и Ко");
  });

  it("переписывает excelSheet, чтобы карточка не показывала старый лист", async () => {
    const green = defaultSuppliers().find((supplier) => supplier.name === "Гринфито");
    if (!green) throw new Error("в справочнике нет «Гринфито»");

    await db.suppliers.bulkPut(defaultSuppliers());
    await db.items.bulkPut([
      { ...item("i1", "Гринфито"), supplierId: green.id, excelSheet: "Гринфито" },
      // Позиция без excelSheet не должна его приобрести.
      { ...item("i2", "Гринфито"), supplierId: green.id },
    ]);

    await putSupplier({ ...green, name: "Гринфито Плюс" });

    expect((await db.items.get("i1"))?.excelSheet).toBe("Гринфито Плюс");
    expect((await db.items.get("i2"))?.excelSheet).toBeUndefined();
  });
});
