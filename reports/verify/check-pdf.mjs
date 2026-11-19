/** Новые кейсы PDF-шапок: английская шапка, реквизиты, дата, строка итогов. */
import { findDocumentDate, parseInvoiceSheet } from "./build/domain/invoice.js";

const sheet = (name, rows) => ({ name, rows });
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log("OK   " + label);
  } catch (error) {
    failed += 1;
    console.log("FAIL " + label + "\n     " + String(error?.message ?? error));
  }
}

function eq(actual, expected, what = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what} ожидалось ${e}, получено ${a}`);
}

check("английская шапка счёта", () => {
  const book = sheet("Страница 1", [
    ["Supplier: Farm Zavod Galen LLC INN 2224031168 KPP 222101001 656011, Barnaul", null],
    ["Invoice No 2804 dated 26.10.2026", null],
    ["No", "Code", "Name", "Qty", "Unit", "Price", "Amount", "Good until"],
    ["1", "4660000647252", "Pantalfit-5 Premium, 30 bricks x 2g", "5", "pcs", "365.00", "1825.00", "18.09.2027"],
  ]);
  const result = parseInvoiceSheet(book);
  eq(result?.supplier, "Farm Zavod Galen LLC", "supplier");
  eq(
    {
      code: result?.rows[0].code,
      name: result?.rows[0].name,
      quantity: result?.rows[0].quantity,
      price: result?.rows[0].price,
      amount: result?.rows[0].amount,
      expiresAt: result?.rows[0].expiresAt,
    },
    {
      code: "4660000647252",
      name: "Pantalfit-5 Premium, 30 bricks x 2g",
      quantity: "5",
      price: "365",
      amount: "1825",
      expiresAt: "2027-09-18",
    },
  );
});

check("отрезает от поставщика реквизиты и адрес", () => {
  const book = sheet("Страница 1", [
    ['Поставщик Общество с ограниченной ответственностью "РИФ И КО", ИНН 0400001746, КПП 040001001, Алтай респ'],
    ["Товар (Услуга)", "Кол-во", "Цена", "Сумма"],
    ["Конфеты шоколадные", 20, 430, 8600],
  ]);
  eq(parseInvoiceSheet(book)?.supplier, 'Общество с ограниченной ответственностью "РИФ И КО"');
});

check("дата документа, а не договора", () => {
  const book = sheet("Страница 1", [
    ["Основание: Договор на поставку конфет №2023/50 от 09.11.2023г."],
    ["Счет на оплату № 640 от 13 июля 2026 г."],
    ["Товар (Услуга)", "Кол-во", "Цена", "Сумма"],
    ["Конфеты шоколадные", 20, 430, 8600],
  ]);
  const result = parseInvoiceSheet(book);
  eq(result?.headerRow, 3, "headerRow");
  eq(findDocumentDate(book, 2), "2026-07-13");
});

check("строка итогов без подписи не становится товаром", () => {
  const book = sheet("Товары", [
    ["№", "Товар (Услуга)", "Код", "Кол-во", "Ед.", "Цена", "Сумма"],
    ["1", "Конфеты шоколадные", "3956", 20, "шт", "430,00", "8 600,00"],
    [null, "43 720", null, "159", null, null, "43 720"],
  ]);
  const result = parseInvoiceSheet(book);
  eq(result?.rows.length, 1, "rows");
  eq(result?.rows[0].name, "Конфеты шоколадные");
});

console.log(`\nвсего 4, провалено ${failed}`);
