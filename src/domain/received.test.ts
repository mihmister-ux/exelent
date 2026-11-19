import { describe, expect, it } from "vitest";

import { receivedLabel, receivedShort } from "./received";

/**
 * Дата поступления в плашке. Правило простое: есть дата — показываем её
 * в привычном складу виде дд.мм.гггг; нет даты — так и говорим, потому что
 * пустое место читается как «привезли сегодня».
 */
describe("receivedLabel", () => {
  it("ISO-дата превращается в дд.мм.гггг с подписью", () => {
    expect(receivedLabel("2026-10-07")).toBe("Поступление: 07.10.2026");
  });

  it("пусто и null — «Поступление не указано»", () => {
    expect(receivedLabel(null)).toBe("Поступление не указано");
    expect(receivedLabel(undefined)).toBe("Поступление не указано");
    expect(receivedLabel("")).toBe("Поступление не указано");
  });

  it("нераспознанная дата — тоже «не указано», а не прочерк", () => {
    expect(receivedLabel("07.10.2026")).toBe("Поступление не указано");
    expect(receivedLabel("2026-13-45")).toBe("Поступление не указано");
  });
});

describe("receivedShort", () => {
  it("для строк с разделителями — строчными и без двоеточия", () => {
    expect(receivedShort("2026-03-01")).toBe("поступление 01.03.2026");
    expect(receivedShort(null)).toBe("поступление не указано");
  });
});
