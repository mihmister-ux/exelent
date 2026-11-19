import { describe, expect, it } from "vitest";

import {
  findDocumentDate,
  parseInvoice,
  parseInvoiceDate,
  parseInvoiceSheet,
  parseNumber,
} from "./invoice";
import type { SheetGrid } from "@/lib/xlsx";

/**
 * Тесты на «сырой» сетке: та же сетку даёт lib/xlsx.ts из любого .xlsx.
 * Здесь проверяется именно логика разбора, без браузера и без Excel-библиотеки.
 */

function sheet(name: string, rows: unknown[][]): SheetGrid {
  return { name, rows };
}

describe("parseNumber", () => {
  it("читает числа с пробелами и запятой", () => {
    expect(parseNumber("1 200,50")).toBe(1200.5);
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber("2,5 кг")).toBe(2.5);
    expect(parseNumber("—")).toBeNull();
  });

  it("не склеивает число из нескольких групп и сохраняет знак", () => {
    // Прежний разбор вырезал «x» и получал 32 — числа, которого нет в счёте.
    expect(parseNumber("3x2")).toBeNull();
    expect(parseNumber("365 за 2 шт")).toBeNull();
    // Скобки — бухгалтерская запись минуса, знак не теряем.
    expect(parseNumber("(3)")).toBe(-3);
    expect(parseNumber("-2")).toBe(-2);
  });

  it("пункт 10: нечитаемое и неположительное количество не становится позицией", () => {
    const book = sheet("Numbers", [
      ["Наименование", "Кол-во", "Цена", "Сумма"],
      ["Товар A", "3x2", 10, 60],
      ["Товар B", "(3)", 10, -30],
      ["Товар C", 0, 10, 0],
      ["Товар D", 2, 10, 20],
    ]);
    const result = parseInvoiceSheet(book);
    expect(result?.rows.map((row) => row.name)).toEqual(["Товар D"]);
    expect(result?.skipped).toEqual([2, 3, 4]);
  });
});

describe("parseInvoiceDate", () => {
  it("читает дату Excel и строки", () => {
    expect(parseInvoiceDate(new Date(2027, 1, 1)).iso).toBe("2027-02-01");
    expect(parseInvoiceDate("01.02.2027").iso).toBe("2027-02-01");
    expect(parseInvoiceDate("01.02.27").iso).toBe("2027-02-01");
    // Из XLSX (raw:false) даты приходят ISO — день и год не меняем местами.
    expect(parseInvoiceDate("2026-09-18").iso).toBe("2026-09-18");
  });

  it("сохраняет битую дату как raw", () => {
    expect(parseInvoiceDate("18.09..29")).toEqual({ iso: null, raw: "18.09..29" });
  });

  it("порядок дня и месяца определяет по значениям, а не по разделителю", () => {
    // 17 месяцем быть не может: обе записи — 17 ноября, хотя разделители разные.
    expect(parseInvoiceDate("11/17/27")).toEqual({ iso: "2027-11-17", raw: null });
    expect(parseInvoiceDate("17/11/27")).toEqual({ iso: "2027-11-17", raw: null });
  });

  it("помечает неоднозначную запись со слэшем, но не с точками", () => {
    // Обе группы ≤ 12: читаем по-русски (2 января), но «/» выдаёт чужой
    // порядок — сомнение видно в поле ambiguous.
    expect(parseInvoiceDate("01/02/27")).toEqual({ iso: "2027-02-01", raw: null, ambiguous: true });
    // Точки — русская запись, сомнений нет.
    expect(parseInvoiceDate("01.02.2027")).toEqual({ iso: "2027-02-01", raw: null });
  });

  it("отсекает несуществующие дни", () => {
    expect(parseInvoiceDate("31.02.2027").iso).toBeNull();
  });
});

describe("parseInvoiceSheet", () => {
  it("находит таблицу ниже шапки с реквизитами и пропускает итоги", () => {
    const book = sheet("Товары", [
      ["ООО «Лотос»"],
      ["ИНН 7726123456", "КПП 772601001", "123456, Москва, ул. Тверская, 1"],
      ["Поставщик: ООО Лотос"],
      ["Накладная № 451 от 12.11.2026"],
      ["№", "Наименование", "Код", "Кол-во", "Ед.", "Цена", "Сумма"],
      [1, "Конфеты шоколадные", "1001", 24, "шт", 100, 2400],
      [2, "Чабрец, 50 г", "1002", 10, "шт", 50, 500],
      ["Итого", "", "", 34, "", "", 2900],
      ["Сдал __________", "Принял __________"],
    ]);

    const result = parseInvoiceSheet(book);
    expect(result).not.toBeNull();
    expect(result?.headerRow).toBe(5);
    expect(result?.supplier).toBe("ООО Лотос");
    expect(result?.rows).toHaveLength(2);
    expect(result?.rows[0]).toMatchObject({
      sourceRow: 6,
      name: "Конфеты шоколадные",
      quantity: "24",
      unit: "шт",
      amount: "2400",
    });
  });

  it("понимает колонку «Годен до» и помечает битую дату", () => {
    const book = sheet("Накладная", [
      ["Поставщик: Алфит"],
      ["Наименование", "Кол-во", "Годен до", "Цена", "Сумма"],
      ["Мёд алтайский", 5, "18.09..29", 200, 1000],
      ["Ромашка, 100 г", 2, new Date(2027, 2, 5), 150, 300],
    ]);

    const result = parseInvoiceSheet(book);
    expect(result?.rows[0]).toMatchObject({
      expiresAt: null,
      rawExpires: "18.09..29",
      warning: "не удалось распознать дату срока",
    });
    expect(result?.rows[1].expiresAt).toBe("2027-03-05");
  });

  it("пункт 9: «Позиция» — заголовок названия, а «Номенклатура» не забирает колонку в код", () => {
    const book = sheet("Aliases", [
      ["Позиция", "Количество", "Цена", "Сумма"],
      ["Услуга", 1, 10, 10],
      ["Номенклатура", 1, 10, 10],
    ]);
    const result = parseInvoiceSheet(book);
    expect(result?.headerRow).toBe(1);
    expect(result?.rows.map((row) => row.name)).toEqual(["Услуга", "Номенклатура"]);
  });

  it("пункт 12: мусорное имя «---» уходит в skipped", () => {
    const book = sheet("Aliases", [
      ["Наименование", "Кол-во", "Цена", "Сумма"],
      ["---", 2, 10, 20],
      ["Крем для рук", 1, 10, 10],
    ]);
    const result = parseInvoiceSheet(book);
    expect(result?.rows.map((row) => row.name)).toEqual(["Крем для рук"]);
    expect(result?.skipped).toContain(2);
  });

  it("пункт 14: скидка суммой и процентом убирает ложное предупреждение «цена × кол-во»", () => {
    const book = sheet("Discount", [
      ["Наименование", "Кол-во", "Цена", "Скидка", "Сумма"],
      ["Со скидкой суммой", 10, 100, "50", 950],
      ["Со скидкой процентом", 10, 100, "5%", 950],
      ["Без скидки", 10, 100, "", 1000],
      ["Расхождение", 10, 100, "", 900],
    ]);
    const result = parseInvoiceSheet(book);
    expect(result?.rows.slice(0, 3).map((row) => row.warning)).toEqual([null, null, null]);
    expect(result?.rows[3].warning).toMatch(/цена × кол-во/);
  });

  it("не принимает реквизиты за товары", () => {
    const book = sheet("Лист1", [
      ["ИНН 7726123456", "КПП 772601001"],
      ["Наименование организации: ООО Ромашка"],
      ["Адрес: Москва, ул. Тверская, 1"],
    ]);
    expect(parseInvoiceSheet(book)).toBeNull();
  });

  it("не принимает за товар строку с номерами колонок под заголовком", () => {
    const book = sheet("Лист_1", [
      ["№", null, "Товар (Услуга)", ...Array(21).fill(null), "Код", ...Array(13).fill(null), "Кол-во", ...Array(4).fill(null), "Ед.", ...Array(2).fill(null), "Цена", ...Array(4).fill(null), "Сумма", ...Array(5).fill(null)],
      ["1", null, "2", ...Array(21).fill(null), "3", ...Array(13).fill(null), "4", ...Array(4).fill(null), "5", ...Array(2).fill(null), "6", ...Array(4).fill(null), "7", ...Array(4).fill(null), "8", ...Array(5).fill(null)],
      ["1", null, "Панталфит-5 Премиум", ...Array(21).fill(null), "4660000647252", ...Array(13).fill(null), 5, ...Array(4).fill(null), "шт", ...Array(2).fill(null), 365, ...Array(4).fill(null), "54,75", ...Array(4).fill(null), 1770.25, ...Array(5).fill(null)],
    ]);
    const result = parseInvoiceSheet(book);
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].name).toBe("Панталфит-5 Премиум");
    expect(result?.skipped).toContain(2);
  });

  it("берёт название из соседней колонки, если в «Наименовании» только номер", () => {
    const book = sheet("Лист1", [
      ["№", "Наименование", "Кол-во", "Цена", "Сумма"],
      [1, "2", "Конфеты шоколадные", 24, 2400],
    ]);
    const result = parseInvoiceSheet(book);
    expect(result?.rows[0]).toMatchObject({
      number: "1",
      name: "Конфеты шоколадные",
    });
  });

  it("берёт первого поставщика из списка листов с таблицей", () => {
    const empty = sheet("Лист1", [["ИНН 1234567890"]]);
    const goods = sheet("Гринфито", [
      ["Наименование", "Кол-во"],
      ["Трава", 3],
    ]);

    const result = parseInvoice([empty, goods]);
    expect(result?.sheet).toBe("Гринфито");
    expect(result?.supplier).toBe("Гринфито");
    expect(result?.rows).toHaveLength(1);
  });

  // Ниже — то, что приходит из PDF (lib/pdf.ts): шапка с реквизитами занимает
  // те же X, что и колонки товаров, а наименование может быть английским.
  it("разбирает английскую шапку счёта", () => {
    const book = sheet("Страница 1", [
      ["Supplier: Farm Zavod Galen LLC INN 2224031168 KPP 222101001 656011, Barnaul", null],
      ["Invoice No 2804 dated 26.10.2026", null],
      ["No", "Code", "Name", "Qty", "Unit", "Price", "Amount", "Good until"],
      ["1", "4660000647252", "Pantalfit-5 Premium, 30 bricks x 2g", "5", "pcs", "365.00", "1825.00", "18.09.2027"],
    ]);

    const result = parseInvoiceSheet(book);
    expect(result?.supplier).toBe("Farm Zavod Galen LLC");
    expect(result?.rows[0]).toMatchObject({
      code: "4660000647252",
      name: "Pantalfit-5 Premium, 30 bricks x 2g",
      quantity: "5",
      price: "365",
      amount: "1825",
      expiresAt: "2027-09-18",
    });
  });

  it("отрезает от поставщика реквизиты и адрес", () => {
    const book = sheet("Страница 1", [
      ['Поставщик Общество с ограниченной ответственностью "РИФ И КО", ИНН 0400001746, КПП 040001001, Алтай респ'],
      ["Товар (Услуга)", "Кол-во", "Цена", "Сумма"],
      ["Конфеты шоколадные", 20, 430, 8600],
    ]);
    expect(parseInvoiceSheet(book)?.supplier).toBe(
      'Общество с ограниченной ответственностью "РИФ И КО"',
    );
  });

  it("не берёт дату договора вместо даты документа", () => {
    const book = sheet("Страница 1", [
      ["Основание: Договор на поставку конфет №2023/50 от 09.11.2023г."],
      ["Счет на оплату № 640 от 13 июля 2026 г."],
      ["Товар (Услуга)", "Кол-во", "Цена", "Сумма"],
      ["Конфеты шоколадные", 20, 430, 8600],
    ]);
    const result = parseInvoiceSheet(book);
    expect(result?.headerRow).toBe(3);
    expect(findDocumentDate(book, 2)).toBe("2026-07-13");
  });

  /**
   * Настоящая раскладка счёта 1С из «Счет-на-оплату-реальный.pdf»: банк,
   * получатель, поставщик, покупатель, «Основание» — и только потом товары.
   * Заголовок документа стоит ВЫШЕ строки «Основание», а договор — НИЖЕ, и
   * прежний проход снизу вверх брал договор, записывая 2023 год в журнал.
   */
  it("берёт дату из заголовка «Счет на оплату», а не из договора ниже", () => {
    const book = sheet("Страница 1", [
      ["ОМСКОЕ ОТДЕЛЕНИЕ N 8634 ПАО СБЕРБАНК г. Омск"],
      ["БИК", "045209673"],
      ['Общество с ограниченной ответственностью "РИФ И КО"'],
      ["Получатель"],
      ["Счет на оплату № 640 от 13 июля 2026 г."],
      ["Поставщик", 'Общество с ограниченной ответственностью "РИФ И КО", ИНН 0400001746'],
      ["Покупатель", 'ООО "САНАТОРИЙ "РУСЬ", ИНН 2305025525'],
      ["Основание:"],
      ["Договор на поставку конфет ручной работы №2023/50 от 09.11.2023г."],
      ["№", "Товар (Услуга)", "Кол-во", "Цена", "Сумма"],
      [1, "Конфеты шоколадные", 20, 430, 8600],
    ]);
    expect(findDocumentDate(book, 9)).toBe("2026-07-13");
    expect(parseInvoiceSheet(book)?.documentDate).toBe("2026-07-13");
  });

  it("понимает дату в заголовке накладной цифрами через точку", () => {
    const book = sheet("Страница 1", [
      ["Накладная № 1058ЮЛ0224 от 16.02.2024"],
      ["Основание: Договор №2023/50 от 09.11.2023г."],
      ["Наименование", "Кол-во", "Цена", "Сумма"],
      ["Конфеты", 20, 430, 8600],
    ]);
    expect(findDocumentDate(book, 2)).toBe("2024-02-16");
  });

  it("запасной вариант: без заголовка дата берётся из «Основание»", () => {
    // Шапки документа нет вовсе — иначе дата осталась бы пустой, и журнал
    // не знал бы, когда пришёл товар.
    const book = sheet("Страница 1", [
      ["Основание: Договор на поставку №2023/50 от 09.11.2023г."],
      ["Наименование", "Кол-во", "Цена", "Сумма"],
      ["Конфеты", 20, 430, 8600],
    ]);
    expect(findDocumentDate(book, 1)).toBe("2023-11-09");
  });

  it("не принимает за дату документа «от» до названия документа", () => {
    // «Договор от 09.11.2023 на оплату» содержит и дату, и слово «оплату»,
    // но дата стоит ДО названия документа — это дата договора.
    const book = sheet("Страница 1", [
      ["Договор от 09.11.2023 на оплату поставки"],
      ["Счет на оплату № 640 от 13 июля 2026 г."],
      ["Наименование", "Кол-во", "Цена", "Сумма"],
      ["Конфеты", 20, 430, 8600],
    ]);
    expect(findDocumentDate(book, 2)).toBe("2026-07-13");
  });

  it("не ищет дату документа ниже заголовка таблицы товаров", () => {
    // Дата из строки товара не должна становиться датой документа.
    const book = sheet("Страница 1", [
      ["Наименование", "Кол-во", "Срок годности"],
      ["Конфеты", 20, "18.09.2029"],
    ]);
    expect(findDocumentDate(book, 0)).toBeNull();
  });

  it("не принимает строку итогов без подписи за товар", () => {
    const book = sheet("Товары", [
      ["№", "Товар (Услуга)", "Код", "Кол-во", "Ед.", "Цена", "Сумма"],
      ["1", "Конфеты шоколадные", "3956", 20, "шт", "430,00", "8 600,00"],
      [null, "43 720", null, "159", null, null, "43 720"],
    ]);
    const result = parseInvoiceSheet(book);
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].name).toBe("Конфеты шоколадные");
  });

  it("не обрывает накладную на маркере внутри названия товара", () => {
    // «итог», «рс», «банк», «всего» здесь — часть названия, а не итог/реквизиты.
    const book = sheet("Товары", [
      ["№", "Наименование", "Кол-во", "Цена", "Сумма"],
      [1, "Фитогель охлаждающий", 2, 100, 200],
      [2, "Персик консервированный", 5, 80, 400],
      [3, "Банка консервная", 1, 90, 90],
      [4, "Морской язык", 3, 120, 360],
      ["Итого", "", 11, "", 1050],
    ]);
    const result = parseInvoiceSheet(book);
    expect(result?.rows.map((r) => r.name)).toEqual([
      "Фитогель охлаждающий",
      "Персик консервированный",
      "Банка консервная",
      "Морской язык",
    ]);
  });

  it("по-прежнему заканчивает разбор на настоящем «Итого»", () => {
    const book = sheet("Товары", [
      ["№", "Наименование", "Кол-во", "Цена", "Сумма"],
      [1, "Конфеты", 2, 50, 100],
      ["Итого", "", 2, "", 100],
      ["Сдал __________", "Принял __________"],
    ]);
    expect(parseInvoiceSheet(book)?.rows.map((r) => r.name)).toEqual(["Конфеты"]);
  });

  it("понимает английский Subtotal как конец таблицы", () => {
    const book = sheet("Items", [
      ["No", "Item", "Qty", "Price", "Total"],
      [1, "Candies", 2, 50, 100],
      ["Subtotal", "", 2, "", 100],
    ]);
    expect(parseInvoiceSheet(book)?.rows.map((r) => r.name)).toEqual(["Candies"]);
  });

  it("собирает таблицы со всех листов книги", () => {
    const first = sheet("Лист1", [
      ["№", "Наименование", "Кол-во", "Цена", "Сумма"],
      [1, "Конфеты", 2, 50, 100],
    ]);
    const second = sheet("Лист2", [
      ["№", "Наименование", "Кол-во", "Цена", "Сумма"],
      [1, "Печенье", 3, 30, 90],
    ]);
    const result = parseInvoice([first, second]);
    expect(result?.rows.map((r) => `${r.sheet}:${r.name}`)).toEqual([
      "Лист1:Конфеты",
      "Лист2:Печенье",
    ]);
    expect(result?.sheets).toHaveLength(2);
  });

  it("продолжает таблицу на листе без заголовка", () => {
    const first = sheet("Страница 1", [
      ["№", "Наименование", "Кол-во", "Цена", "Сумма"],
      [1, "Конфеты", 2, 50, 100],
    ]);
    // Вторая страница PDF: заголовка нет, строки идут теми же колонками.
    const second = sheet("Страница 2", [
      [3, "Печенье", 4, 30, 120],
    ]);
    const result = parseInvoice([first, second]);
    expect(result?.rows.map((r) => r.name)).toEqual(["Конфеты", "Печенье"]);
    expect(result?.sheets[1].continuation).toBe(true);
  });

  it("не принимает служебный лист без заголовка за продолжение таблицы", () => {
    const first = sheet("Лист1", [
      ["№", "Наименование", "Кол-во", "Цена", "Сумма"],
      [1, "Конфеты", 2, 50, 100],
    ]);
    const junk = sheet("Справочники", [
      ["Склад", "Аптека №7"],
      ["Телефон", "+7 495 000-00-00"],
    ]);
    const result = parseInvoice([first, junk]);
    expect(result?.rows.map((r) => r.name)).toEqual(["Конфеты"]);
    expect(result?.sheets).toHaveLength(1);
  });
});
