import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "./db";
import { archiveSupplier, countInStock, deleteSupplier, mergeSuppliers } from "./suppliers";
import type { ShelfItem, Supplier } from "./types";
import { findSimilarSuppliers, mergeCandidates, mergedAliases, similarReason } from "@/domain/suppliers";

function supplier(id: string, name: string, aliases: string[] = []): Supplier {
  return { id, name, color: "#1d4ed8", aliases, hidden: false, order: 10 };
}

function item(
  id: string,
  supplierName: string,
  status: ShelfItem["status"] = "in_stock",
  excelSheet?: string,
): ShelfItem {
  return {
    id,
    name: `Товар ${id}`,
    supplier: supplierName,
    status,
    marked: false,
    expiresAt: null,
    ...(excelSheet ? { excelSheet } : {}),
  };
}

beforeEach(async () => {
  await db.items.clear();
  await db.suppliers.clear();
});

describe("mergeSuppliers", () => {
  it("переносит все товары — включая проданные и списанные", async () => {
    await db.suppliers.bulkPut([supplier("old", "Две Линии"), supplier("new", "ПКФ Две Линии")]);
    await db.items.bulkPut([
      item("i1", "Две Линии"),
      item("i2", "Две Линии", "sold"),
      item("i3", "Две Линии", "written_off"),
      item("i4", "Поставщик Х"),
    ]);

    await mergeSuppliers("old", "new");

    const items = await db.items.toArray();
    expect(items.filter((i) => i.supplier === "ПКФ Две Линии")).toHaveLength(3);
    expect(items.find((i) => i.id === "i4")?.supplier).toBe("Поставщик Х");
  });

  it("архивирует старого и добавляет его написания в алиасы нового", async () => {
    await db.suppliers.bulkPut([
      supplier("old", "Две Линии", ["ДВЕ ЛИНИИ ООО"]),
      supplier("new", "ПКФ Две Линии"),
    ]);

    await mergeSuppliers("old", "new");

    const old = await db.suppliers.get("old");
    const target = await db.suppliers.get("new");
    expect(old?.hidden).toBe(true);
    expect(old?.aliases).toContain("Две Линии");
    expect(target?.aliases).toEqual(
      expect.arrayContaining(["Две Линии", "ДВЕ ЛИНИИ ООО"]),
    );
  });

  it("находит товары по алиасу старого написания", async () => {
    await db.suppliers.bulkPut([
      supplier("old", "Две Линии", ["ООО ПКФ ДВЕ ЛИНИИ"]),
      supplier("new", "ПКФ Две Линии"),
    ]);
    await db.items.bulkPut([item("i1", "ООО ПКФ ДВЕ ЛИНИИ")]);

    await mergeSuppliers("old", "new");

    expect((await db.items.toArray())[0].supplier).toBe("ПКФ Две Линии");
  });

  it("переписывает excelSheet на имя целевого поставщика", async () => {
    await db.suppliers.bulkPut([supplier("old", "Две Линии"), supplier("new", "ПКФ Две Линии")]);
    await db.items.bulkPut([
      item("i1", "Две Линии", "in_stock", "Две Линии"),
      item("i2", "Две Линии", "sold", "ДВЕ ЛИНИИ ООО"),
      item("i3", "Поставщик Х", "in_stock", "Поставщик Х"),
    ]);

    await mergeSuppliers("old", "new");

    const items = await db.items.toArray();
    expect(items.find((i) => i.id === "i1")?.excelSheet).toBe("ПКФ Две Линии");
    expect(items.find((i) => i.id === "i2")?.excelSheet).toBe("ПКФ Две Линии");
    // Чужие позиции лист не меняют.
    expect(items.find((i) => i.id === "i3")?.excelSheet).toBe("Поставщик Х");
  });

  it("не даёт объединить поставщика с самим собой", async () => {
    await expect(mergeSuppliers("x", "x")).rejects.toThrow("с самим собой");
  });
});

describe("archiveSupplier", () => {
  it("архивирует, если в наличии нет товаров", async () => {
    await db.suppliers.put(supplier("s", "Пустой"));
    await db.items.bulkPut([
      item("i1", "Пустой", "sold"),
      item("i2", "Пустой", "written_off"),
    ]);

    await archiveSupplier("s");

    expect((await db.suppliers.get("s"))?.hidden).toBe(true);
    expect(await db.items.count()).toBe(2);
  });

  it("блокирует архивацию, если есть товар в наличии", async () => {
    await db.suppliers.put(supplier("s", "Полный"));
    await db.items.put(item("i1", "Полный"));

    await expect(archiveSupplier("s")).rejects.toThrow("есть товары в наличии");
    expect((await db.suppliers.get("s"))?.hidden).toBe(false);
  });

  it("учитывает товары по алиасу", async () => {
    await db.suppliers.put(supplier("s", "Полный", ["ПОЛНЫЙ ООО"]));
    await db.items.put(item("i1", "ПОЛНЫЙ ООО"));

    const saved = await db.suppliers.get("s");
    if (!saved) throw new Error("ожидали запись справочника");
    expect(await countInStock(saved)).toBe(1);
    await expect(archiveSupplier("s")).rejects.toThrow();
  });
});

describe("deleteSupplier", () => {
  it("переносит все товары на выбранного поставщика и удаляет запись", async () => {
    await db.suppliers.bulkPut([supplier("gone", "Две Линии"), supplier("keep", "Лотос")]);
    await db.items.bulkPut([
      item("i1", "Две Линии"),
      item("i2", "Две Линии", "sold"),
      item("i3", "Две Линии", "written_off"),
      item("i4", "Лотос"),
    ]);

    const result = await deleteSupplier("gone", "keep");

    expect(result).toEqual({ moved: 3, targetName: "Лотос" });
    expect(await db.suppliers.get("gone")).toBeUndefined();

    const items = await db.items.toArray();
    expect(items.filter((i) => i.supplier === "Лотос")).toHaveLength(4);
    // Ссылка тоже переехала — иначе позиция выпала бы из фильтра по справочнику.
    for (const id of ["i1", "i2", "i3"]) {
      expect(items.find((i) => i.id === id)?.supplierId).toBe("keep");
    }
  });

  it("переносит excelSheet на имя нового поставщика", async () => {
    await db.suppliers.bulkPut([supplier("gone", "Две Линии"), supplier("keep", "Лотос")]);
    await db.items.bulkPut([item("i1", "Две Линии", "in_stock", "Две Линии")]);

    await deleteSupplier("gone", "keep");

    expect((await db.items.get("i1"))?.excelSheet).toBe("Лотос");
  });

  it("находит товары по алиасу без supplierId", async () => {
    await db.suppliers.bulkPut([
      supplier("gone", "Две Линии", ["ООО ПКФ ДВЕ ЛИНИИ"]),
      supplier("keep", "Лотос"),
    ]);
    await db.items.put(item("i1", "ООО ПКФ ДВЕ ЛИНИИ"));

    const result = await deleteSupplier("gone", "keep");

    expect(result.moved).toBe(1);
    expect((await db.items.get("i1"))?.supplier).toBe("Лотос");
  });

  it("с targetId = null оставляет товары без поставщика", async () => {
    await db.suppliers.put(supplier("gone", "Две Линии"));
    await db.items.put(item("i1", "Две Линии"));

    const result = await deleteSupplier("gone", null);

    expect(result).toEqual({ moved: 1, targetName: null });
    expect(await db.suppliers.get("gone")).toBeUndefined();

    const saved = await db.items.get("i1");
    expect(saved?.supplier).toBe("Без поставщика");
    expect(saved?.supplierId).toBeNull();
    expect(saved?.excelSheet).toBeNull();
  });

  it("пустого поставщика удаляет, ничего не перенося", async () => {
    await db.suppliers.bulkPut([supplier("gone", "Пустой"), supplier("keep", "Лотос")]);

    const result = await deleteSupplier("gone", null);

    expect(result).toEqual({ moved: 0, targetName: null });
    expect(await db.suppliers.get("gone")).toBeUndefined();
    expect(await db.items.count()).toBe(0);
  });

  it("не даёт перенести на самого удаляемого", async () => {
    await db.suppliers.put(supplier("gone", "Две Линии"));
    await expect(deleteSupplier("gone", "gone")).rejects.toThrow("на удаляемого поставщика");
  });

  it("падает на несуществующем поставщике для переноса", async () => {
    await db.suppliers.put(supplier("gone", "Две Линии"));
    await expect(deleteSupplier("gone", "nope")).rejects.toThrow("для переноса не найден");
    // Транзакция откатилась: запись на месте.
    expect(await db.suppliers.get("gone")).toBeDefined();
  });
});

describe("поиск похожих", () => {
  it("находит «Две Линии» и «ООО ПКФ ДВЕ ЛИНИИ»", () => {
    const found = findSimilarSuppliers([
      supplier("a", "Две Линии"),
      supplier("b", 'ООО "ПКФ "ДВЕ ЛИНИИ"'),
      supplier("c", "Лотос"),
    ]);
    expect(found).toHaveLength(1);
    expect([found[0].a.id, found[0].b.id].sort()).toEqual(["a", "b"]);
  });

  it("не предлагает разных поставщиков", () => {
    expect(
      findSimilarSuppliers([supplier("a", "Гринфито"), supplier("b", "Лотос")]),
    ).toHaveLength(0);
  });

  it("mergedAliases не дублирует имя целевого", () => {
    const aliases = mergedAliases(supplier("a", "Две Линии"), supplier("b", "ПКФ Две Линии"));
    expect(aliases).toContain("Две Линии");
    expect(aliases).not.toContain("ПКФ Две Линии");
  });
});

describe("кандидаты для списка «Новый поставщик»", () => {
  const directory = [
    supplier("a", "Две Линии"),
    supplier("b", 'ООО "ПКФ "ДВЕ ЛИНИИ"'),
    supplier("c", "Две Линии Аптека"),
    supplier("d", "Лотос"),
    supplier("e", "Гринфито"),
  ];

  it("показывает только похожих по первым словам", () => {
    const { exact, similar } = mergeCandidates(directory, "a");
    const ids = [...exact, ...similar].map((s) => s.id).sort();
    // «Лотос» и «Гринфито» к «Две Линии» отношения не имеют.
    expect(ids).toEqual(["b", "c"]);
  });

  it("полный дубль едет в exact, похожее имя — в similar", () => {
    const { exact, similar } = mergeCandidates(directory, "a");
    expect(exact.map((s) => s.id)).toEqual(["b"]);
    expect(similar.map((s) => s.id)).toEqual(["c"]);
  });

  it("не предлагает самого себя", () => {
    const { exact, similar } = mergeCandidates(directory, "d");
    expect([...exact, ...similar]).toHaveLength(0);
  });

  it("архивные записи в кандидаты не попадают", () => {
    const withHidden = [...directory, { ...supplier("z", "Две Линии Старая"), hidden: true }];
    const { exact, similar } = mergeCandidates(withHidden, "a");
    expect([...exact, ...similar].some((s) => s.id === "z")).toBe(false);
  });

  it("совпадают первые 3 значимых слова — тоже похоже", () => {
    expect(similarReason("Риф и Ко", "Риф и Ко Торговый")).not.toBeNull();
    expect(similarReason("Риф и Ко", "Лотос")).toBeNull();
  });
});
