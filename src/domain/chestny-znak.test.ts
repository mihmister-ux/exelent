import { describe, expect, it } from "vitest";

import { describeChestnyZnak, parseChestnyZnak } from "./chestny-znak";

const GS = "\u001d";

describe("parseChestnyZnak", () => {
  it("разбирает код с разделителями GS (как отдаёт сканер)", () => {
    const code = parseChestnyZnak(`01${"04601234567890"}21ABC123${GS}91EE5A${GS}92XYZ`);

    expect(code.gtin).toBe("04601234567890");
    expect(code.serial).toBe("ABC123");
    expect(code.verifyKey).toBe("EE5A");
    expect(code.crypto).toBe("XYZ");
    expect(code.looksLikeMarking).toBe(true);
  });

  it("разбирает код с FNC1 (\\u00e9) вместо GS", () => {
    const code = parseChestnyZnak(`01${"04601234567890"}21SER999${"\u00e9"}91AB12${"\u00e9"}92TAIL`);

    expect(code.gtin).toBe("04601234567890");
    expect(code.serial).toBe("SER999");
    expect(code.verifyKey).toBe("AB12");
  });

  it("разбирает «склеенную» строку без разделителей", () => {
    const code = parseChestnyZnak("010460123456789021SERIAL000191EE5A92CRYPTO");

    expect(code.gtin).toBe("04601234567890");
    expect(code.serial).toBe("SERIAL0001");
    expect(code.verifyKey).toBe("EE5A");
    expect(code.crypto).toBe("CRYPTO");
  });

  it("код без серийника не считается маркировкой, но GTIN достаёт", () => {
    const code = parseChestnyZnak("0104601234567890");

    expect(code.gtin).toBe("04601234567890");
    expect(code.serial).toBeNull();
    expect(code.looksLikeMarking).toBe(false);
  });

  it("не падает на мусоре", () => {
    const code = parseChestnyZnak("какой-то текст");

    expect(code.gtin).toBeNull();
    expect(code.serial).toBeNull();
    expect(code.looksLikeMarking).toBe(false);
    expect(code.raw).toBe("какой-то текст");
  });

  it("не падает на пустой строке", () => {
    const code = parseChestnyZnak("");

    expect(code.gtin).toBeNull();
    expect(code.looksLikeMarking).toBe(false);
  });

  it("убирает переводы строк, которые подмешивает сканер", () => {
    const code = parseChestnyZnak("010460123456789021SER1\r\n");

    expect(code.gtin).toBe("04601234567890");
    expect(code.serial).toBe("SER1");
  });
});

describe("describeChestnyZnak", () => {
  it("показывает GTIN и серийник", () => {
    const code = parseChestnyZnak(`01${"04601234567890"}21ABC${GS}`);
    expect(describeChestnyZnak(code)).toContain("GTIN 04601234567890");
    expect(describeChestnyZnak(code)).toContain("сер. ABC");
  });

  it("сообщает, если код не распознан", () => {
    expect(describeChestnyZnak(parseChestnyZnak("abc"))).toBe("Код не распознан");
  });
});
