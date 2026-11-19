import { describe, expect, it } from "vitest";

import { expiringWithin, weekExpiry } from "@/domain/groups";

function item(name: string, expiresAt: string | null, status: "in_stock" | "sold" = "in_stock") {
  return { name, expiresAt, status };
}

const ON = new Date(2026, 10, 12); // 12.11.2026

describe("weekExpiry / expiringWithin", () => {
  it("находит позиции с истечением в пределах 7 дней", () => {
    const items = [
      item("Сегодня", "2026-11-12"),
      item("Через день", "2026-11-13"),
      item("Через неделю", "2026-11-19"), // ровно +7
      item("Через 8 дней", "2026-11-20"), // вне окна
      item("Без даты", null),
    ];
    const result = expiringWithin(items, ON, 7).map((i) => i.name);
    expect(result).toEqual(["Сегодня", "Через день", "Через неделю"]);
  });

  it("исключает проданные и списанные", () => {
    const items = [
      item("Есть", "2026-11-13"),
      item("Продано", "2026-11-13", "sold"),
    ];
    expect(expiringWithin(items, ON, 7).map((i) => i.name)).toEqual(["Есть"]);
  });

  it("считает итог и границы", () => {
    const items = [
      item("Просрочен вчера", "2026-11-11"),
      item("Сегодня", "2026-11-12"),
      item("Через три дня", "2026-11-15"),
      item("Далеко", "2026-12-01"),
    ];
    const result = weekExpiry(items, ON, 7);
    expect(result.count).toBe(3);
    expect(result.from).toBe("2026-11-11");
    expect(result.to).toBe("2026-11-15");
    expect(result.hasExpired).toBe(true);
    expect(result.names).toContain("Сегодня");
  });
});