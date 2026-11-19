import { describe, expect, it } from "vitest";

import { EXPIRY_STYLE, expiryInfo, expiryKind, SOON_DAYS, WARNING_DAYS } from "@/domain/expiry";
import { addDays, toISODate } from "@/lib/dates";

/** Снимок брифа: 12.11.2026. Все проверки — от этой даты, как в отчёте этапа 1. */
const TODAY = new Date(2026, 10, 12);
const iso = (offset: number) => toISODate(addDays(TODAY, offset));

describe("expiryKind — границы из Excel", () => {
  it("считает дни относительно TODAY() по календарным дням", () => {
    expect(expiryKind(iso(0), TODAY)).toBe("soon");
    expect(expiryKind(iso(1), TODAY)).toBe("soon");
  });

  it("ровно +30 — ещё красная зона, +31 — уже жёлтая", () => {
    expect(expiryKind(iso(SOON_DAYS), TODAY)).toBe("soon");
    expect(expiryKind(iso(SOON_DAYS + 1), TODAY)).toBe("warning");
  });

  it("ровно +60 — ещё жёлтая зона, +61 — без подсветки", () => {
    expect(expiryKind(iso(WARNING_DAYS), TODAY)).toBe("warning");
    expect(expiryKind(iso(WARNING_DAYS + 1), TODAY)).toBe("ok");
  });

  it("день до TODAY() — уже просрочен", () => {
    expect(expiryKind(iso(-1), TODAY)).toBe("expired");
    expect(expiryKind(iso(-400), TODAY)).toBe("expired");
  });

  it("пусто и текст вместо даты — «Без срока», а не просрочено", () => {
    expect(expiryKind(null, TODAY)).toBe("no_date");
    expect(expiryKind(undefined, TODAY)).toBe("no_date");
    expect(expiryKind("", TODAY)).toBe("no_date");
    // Реальная строка из источника: Алфит!D25 = '18.09..29'
    expect(expiryKind("18.09..29", TODAY)).toBe("no_date");
    // И несуществующая дата тоже не должна попасть в просроченные.
    expect(expiryKind("2026-02-31", TODAY)).toBe("no_date");
  });
});

describe("сверка с формулами условного форматирования", () => {
  /** Три правила листов A4:I1003, записанные ровно как в Excel. */
  function excelRule(offsetDays: number): "expired" | "soon" | "warning" | "none" {
    if (offsetDays < 0) return "expired";
    if (offsetDays >= 0 && offsetDays <= 30) return "soon";
    if (offsetDays > 30 && offsetDays <= 60) return "warning";
    return "none";
  }

  it("на 1201 дне подряд результат совпадает с правилами таблицы", () => {
    for (let offset = -600; offset <= 600; offset += 1) {
      const expected = excelRule(offset);
      const actual = expiryKind(iso(offset), TODAY);
      expect(actual === "ok" ? "none" : actual).toBe(expected);
    }
  });

  it("колонка F источника: «Просрочен» только у просроченных", () => {
    for (const offset of [-10, -1, 0, 1, 30, 31, 60, 61, 500]) {
      const info = expiryInfo(iso(offset), TODAY);
      expect(info.excelFCell).toBe(offset < 0 ? "Просрочен" : "");
    }
    expect(expiryInfo(null, TODAY).excelFCell).toBe("");
  });
});

describe("цвета взяты из источника, а не подобраны заново", () => {
  it("совпадает с условным форматированием #8B0000 / #FF0000 / #FFEB9C", () => {
    expect(EXPIRY_STYLE.expired.fill?.toLowerCase()).toBe("#8b0000");
    expect(EXPIRY_STYLE.soon.fill?.toLowerCase()).toBe("#ff0000");
    expect(EXPIRY_STYLE.warning.fill?.toLowerCase()).toBe("#ffeb9c");
    // Тёмно-красная и красная заливки в таблице шли с белым шрифтом,
    // жёлтая — с чёрным.
    expect(EXPIRY_STYLE.expired.textColor?.toLowerCase()).toBe("#ffffff");
    expect(EXPIRY_STYLE.soon.textColor?.toLowerCase()).toBe("#ffffff");
    expect(EXPIRY_STYLE.warning.textColor?.toLowerCase()).toBe("#1a1714");
  });

  it("у «в порядке» и «без срока» заливки нет — Excel их не красил", () => {
    expect(EXPIRY_STYLE.ok.fill).toBeNull();
    expect(EXPIRY_STYLE.no_date.fill).toBeNull();
  });
});

describe("подписи", () => {
  it("просроченный считает дни назад, истекающий — вперёд", () => {
    expect(expiryInfo(iso(-15), TODAY).headline).toBe("просрочен 15 дней назад");
    expect(expiryInfo(iso(-1), TODAY).headline).toBe("просрочен 1 день назад");
    expect(expiryInfo(iso(0), TODAY).headline).toBe("истекает сегодня");
    expect(expiryInfo(iso(2), TODAY).headline).toBe("осталось 2 дня");
    expect(expiryInfo(iso(45), TODAY).headline).toBe("осталось 45 дней");
    expect(expiryInfo(null, TODAY).headline).toBe("срок не указан");
  });
});
