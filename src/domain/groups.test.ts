import { describe, expect, it } from "vitest";

import { seedItems } from "@/data/seedItems";
import { ALL_SUPPLIERS, filterItems, NO_SUPPLIER, supplierOptions } from "@/domain/filter";
import { activeItems, GROUP_ORDER, groupItems, summarize } from "@/domain/groups";
import { expiryInfo } from "@/domain/expiry";
import { defaultSuppliers } from "@/domain/suppliers";

const TODAY = new Date(2026, 10, 12);
const items = seedItems();

describe("данные этапа 1 в схеме приложения", () => {
  it("146 позиций, из них 16 продано", () => {
    expect(items).toHaveLength(146);
    expect(items.filter((item) => item.status === "sold")).toHaveLength(16);
  });

  it("контрольные суммы совпадают с reports/import-report.md", () => {
    expect(summarize(items, TODAY)).toEqual({
      total: 146,
      expired: 1,
      soon: 2,
      warning: 0,
      ok: 99,
      noDate: 44,
      writtenOff: 16,
      marked: 5,
    });
  });

  it("текст вместо даты сохранён и не превратился в срок", () => {
    const pulmotab = items.find((item) => item.name.includes("Пульмотаб"));
    expect(pulmotab?.expiresAt).toBeNull();
    expect(pulmotab?.rawExpires).toBe("18.09..29");
    expect(expiryInfo(pulmotab?.expiresAt, TODAY).kind).toBe("no_date");
  });

  it("адрес строки в Excel сохранён — выгрузка восстановит колонки 1:1", () => {
    const rif = items.filter((item) => item.supplier === "Риф и Ко");
    expect(rif).toHaveLength(10);
    expect(rif.every((item) => item.excelSheet === "Риф и Ко")).toBe(true);
    expect(rif.some((item) => item.excelRow === 13)).toBe(true);
  });

  it("поставщиков семь — по числу листов журнала", () => {
    expect(supplierOptions(items, defaultSuppliers())).toHaveLength(7);
  });
});

describe("группировка экрана «Сроки»", () => {
  const groups = groupItems(activeItems(items), TODAY);

  it("порядок групп: просрочено → ≤30 → 31–60 → остальное → без срока", () => {
    expect(groups.map((group) => group.meta.id)).toEqual([...GROUP_ORDER]);
    expect(groups.map((group) => group.meta.title)).toEqual([
      "Просрочено",
      "Истекает ≤30 дней",
      "Истекает 31–60 дней",
      "Всё остальное",
      "Без срока",
    ]);
  });

  it("выбывшие в «Сроки» не попадают: 146 − 16 = 130", () => {
    const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
    expect(total).toBe(130);
  });

  it("просроченная строка отчёта продана — в «Сроки» её нет, она в архиве", () => {
    // Сверено с источником (fixtures/Учёт сроков хранения.xlsm, лист «Риф и Ко»,
    // строка 13, п/н 10): «Кедровое пралине», годен до 11/1/26, колонка F
    // «Просрочен», колонка G «продан». Это единственная просроченная строка
    // журнала, и она выбывшая, поэтому в «Сроки» (только наличие) не попадает.
    // Итог «Просрочено: 1» в отчёте импорта считался по всем 146 строкам.
    const all = groupItems(items, TODAY).find((group) => group.meta.id === "expired");
    expect(all?.entries).toHaveLength(1);
    expect(all?.entries[0].item.expiresAt).toBe("2026-11-01");
    expect(all?.entries[0].item.supplier).toBe("Риф и Ко");
    expect(all?.entries[0].item.status).toBe("sold");

    const expired = groups.find((group) => group.meta.id === "expired");
    expect(expired?.entries).toHaveLength(0);
  });

  it("«Без срока» сохраняет все 44 позиции и не теряется внизу списка", () => {
    const noDate = groups.find((group) => group.meta.id === "no_date");
    expect(noDate?.entries).toHaveLength(44);
  });

  it("внутри групп даты идут по возрастанию", () => {
    for (const group of groups) {
      const days = group.entries
        .map((entry) => entry.expiry.days)
        .filter((value): value is number => value !== null);
      const sorted = [...days].sort((a, b) => a - b);
      expect(days).toEqual(sorted);
    }
  });
});

describe("фильтрация", () => {
  const directory = defaultSuppliers();

  it("ищет по названию без учёта регистра", () => {
    const found = filterItems(items, { query: "ЗАЙЧИК", supplier: ALL_SUPPLIERS });
    expect(found).toHaveLength(2);
    expect(found.every((item) => item.name.includes("зайчик"))).toBe(true);
  });

  it("ищет по нескольким словам в любом порядке", () => {
    const found = filterItems(items, { query: "пульмотаб травяные", supplier: ALL_SUPPLIERS });
    expect(found).toHaveLength(1);
  });

  it("фильтрует по поставщику и складывается с поиском", () => {
    const lotos = filterItems(items, { query: "", supplier: "Лотос ООО" });
    expect(lotos).toHaveLength(21);
    expect(lotos.every((item) => item.supplier === "Лотос ООО")).toBe(true);

    const nothing = filterItems(items, { query: "зайчик", supplier: "Лотос ООО" });
    expect(nothing).toHaveLength(0);
  });

  it("выбор чистого имени из справочника собирает и «сырые» написания", () => {
    // В списке стоит «Лотос» (имя записи), а позиции помнят «Лотос ООО».
    const lotos = filterItems(items, { query: "", supplier: "Лотос" }, directory);
    expect(lotos).toHaveLength(21);
  });

  it("находит позицию по исходному тексту вместо даты", () => {
    const found = filterItems(items, { query: "18.09..29", supplier: ALL_SUPPLIERS });
    expect(found).toHaveLength(1);
  });
});

describe("список поставщиков для фильтра", () => {
  const directory = defaultSuppliers();

  it("состоит из активных записей справочника в порядке вкладок", () => {
    expect(supplierOptions(items, directory)).toEqual([
      "Гринфито",
      "Две Линии",
      "Лотос",
      "Пенталис",
      "Риф и Ко",
      "Алфит",
      "ЛБренд (Кавказский травник)",
    ]);
  });

  it("«сырое» имя, которого нет в справочнике, не попадает в список", () => {
    const dirty = [
      ...items,
      { ...items[0], id: "raw", supplier: "ООО «Ромашка», ИНН 2224031168" },
    ];
    const options = supplierOptions(dirty, directory);
    expect(options.some((name) => name.includes("ИНН"))).toBe(false);
    // Вместо него — понятный пункт в конце списка.
    expect(options[options.length - 1]).toBe(NO_SUPPLIER);
  });

  it("без «сырых» имён пункта «Без поставщика» нет", () => {
    expect(supplierOptions(items, directory)).not.toContain(NO_SUPPLIER);
  });

  it("«Без поставщика» показывает только неизвестные написания", () => {
    const dirty = [
      ...items,
      { ...items[0], id: "raw", supplier: "ООО «Ромашка», ИНН 2224031168" },
    ];
    const found = filterItems(dirty, { query: "", supplier: NO_SUPPLIER }, directory);
    expect(found.map((item) => item.id)).toEqual(["raw"]);
  });

  it("архивная запись в списке не появляется", () => {
    const withHidden = [...directory, { ...directory[0], id: "old", name: "Две Линии Старая", hidden: true }];
    expect(supplierOptions(items, withHidden)).not.toContain("Две Линии Старая");
  });
});
