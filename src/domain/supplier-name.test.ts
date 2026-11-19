import { describe, expect, it } from "vitest";

import { cleanSupplierName, hasSupplierNoise, supplierNameKey } from "./supplier-name";

/** Написания из настоящих данных проекта: журнал Excel и накладные. */
const SAMPLES: Array<[string, string]> = [
  ["ГРИНФИТО ООО", "Гринфито"],
  ["Лотос ООО", "Лотос"],
  ["ООО Лотос", "Лотос"],
  ["Риф и Ко", "Риф и Ко"],
  ["Две Линии", "Две Линии"],
  ["Пенталис", "Пенталис"],
  ["Алфит", "Алфит"],
  ['ООО "ПКФ "ДВЕ ЛИНИИ"', "Две Линии"],
  ["ООО ПКФ Две Линии", "Две Линии"],
  ["ЛБренд Кавказский травник (ист1", "ЛБренд Кавказский травник"],
];

describe("cleanSupplierName — написания из проекта", () => {
  for (const [raw, expected] of SAMPLES) {
    it(`${raw} → ${expected}`, () => {
      expect(cleanSupplierName(raw)).toBe(expected);
    });
  }
});

describe("cleanSupplierName — реквизиты", () => {
  it("режет строку по ИНН", () => {
    expect(cleanSupplierName('Общество с ограниченной ответственностью "РИФ И КО", ИНН 0400001746, КПП 040001001, 649002, Алтай респ')).toBe("Риф и Ко");
  });

  it("режет по адресу и телефону", () => {
    expect(cleanSupplierName("ООО Ромашка, г. Москва, ул. Ленина, д. 5, тел.: +7 495 123-45-67")).toBe("Ромашка");
  });

  it("латинские реквизиты зарубежного поставщика", () => {
    expect(cleanSupplierName("Farm Zavod Galen LLC INN 2224031168 KPP 222101001 656011, Barnaul")).toBe("Farm Zavod Galen LLC");
  });

  it("индекс без маркера тоже обрывает имя", () => {
    expect(cleanSupplierName("Ромашка 649002 Алтай респ")).toBe("Ромашка");
  });

  it("длинное число без маркера обрывает имя", () => {
    expect(cleanSupplierName("Ромашка 2224031168")).toBe("Ромашка");
  });
});

describe("имена, которые трогать нельзя", () => {
  for (const name of ["Риф и Ко", "Две Линии", "Лотос", "Алфит", "Гринфито", "Иванов", "Восток"]) {
    it(`«${name}» остаётся как есть`, () => {
      expect(cleanSupplierName(name)).toBe(name);
      expect(hasSupplierNoise(name)).toBe(false);
    });
  }

  it("«Риф и Ко» не теряет строчное «и»", () => {
    expect(cleanSupplierName("Риф и Ко")).toBe("Риф и Ко");
  });

  it("написание автора не переписывается по буквам", () => {
    expect(cleanSupplierName("ЛБренд Кавказский травник")).toBe("ЛБренд Кавказский травник");
  });
});

describe("идемпотентность", () => {
  for (const [raw] of SAMPLES) {
    it(`двойная очистка «${raw}» ничего не меняет`, () => {
      const once = cleanSupplierName(raw);
      expect(cleanSupplierName(once)).toBe(once);
    });
  }
});

describe("пустое и мусорное", () => {
  it("пустую строку возвращает пустой", () => {
    expect(cleanSupplierName("")).toBe("");
    expect(cleanSupplierName("   ")).toBe("");
  });

  it("одно «ООО» не превращается в пустоту", () => {
    expect(cleanSupplierName("ООО")).toBe("ООО");
  });

  it("только реквизиты не дают пустого имени", () => {
    expect(cleanSupplierName("ИНН 2224031168")).not.toBe("");
  });
});

describe("supplierNameKey — сравнение написаний", () => {
  it("«ГРИНФИТО ООО» и «Гринфито» — один ключ", () => {
    expect(supplierNameKey("ГРИНФИТО ООО")).toBe(supplierNameKey("Гринфито"));
  });

  it("«Лотос ООО» и «ООО Лотос» — один ключ", () => {
    expect(supplierNameKey("Лотос ООО")).toBe(supplierNameKey("ООО Лотос"));
  });

  it("«Две Линии» и строка с реквизитами — один ключ", () => {
    expect(supplierNameKey("Две Линии")).toBe(
      supplierNameKey('ООО "ПКФ "ДВЕ ЛИНИИ", ИНН 0400001746'),
    );
  });

  it("разные поставщики — разные ключи", () => {
    expect(supplierNameKey("Лотос")).not.toBe(supplierNameKey("Пенталис"));
  });

  it("«Лотос» и «Лотос Плюс» — разные ключи", () => {
    expect(supplierNameKey("Лотос")).not.toBe(supplierNameKey("Лотос Плюс"));
  });
});

describe("hasSupplierNoise", () => {
  it("видит форму юрлица", () => {
    expect(hasSupplierNoise("ГРИНФИТО ООО")).toBe(true);
    expect(hasSupplierNoise("ООО ПКФ Две Линии")).toBe(true);
  });

  it("видит реквизиты и обрывок листа", () => {
    expect(hasSupplierNoise("Ромашка, ИНН 2224031168")).toBe(true);
    expect(hasSupplierNoise("ЛБренд Кавказский травник (ист1")).toBe(true);
  });

  it("чистое имя шума не даёт", () => {
    expect(hasSupplierNoise("Красный Восток")).toBe(false);
  });
});
