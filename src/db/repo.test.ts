import { describe, expect, it } from "vitest";
import { nameKey } from "./repo";

/**
 * Тесты на ключ дубликата.
 *
 * Правило: поставщик + название + срок + дата поступления. Один и тот же товар
 * с разным сроком или принятый в другой день — разные партии, не дубли. Без
 * срока/даты нормализуется в пустую строку.
 */

function item(name: string, supplier: string, expiresAt?: string | null, receivedAt?: string | null) {
  return { name, supplier, expiresAt: expiresAt ?? null, receivedAt: receivedAt ?? null };
}

describe("nameKey", () => {
  it("разные поставщики — разные ключи", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15"));
    const b = nameKey(item("Чай зелёный", "Поставщик Б", "2026-01-15"));
    expect(a).not.toBe(b);
  });

  it("разные названия — разные ключи", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15"));
    const b = nameKey(item("Кофе", "Поставщик А", "2026-01-15"));
    expect(a).not.toBe(b);
  });

  it("разные сроки — разные ключи (разные партии)", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15"));
    const b = nameKey(item("Чай зелёный", "Поставщик А", "2026-06-01"));
    expect(a).not.toBe(b);
  });

  it("одинаковые сроки — одинаковый ключ (дубль)", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15"));
    const b = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15"));
    expect(a).toBe(b);
  });

  it("обе без срока — одинаковый ключ (дубль)", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", null));
    const b = nameKey(item("Чай зелёный", "Поставщик А", null));
    expect(a).toBe(b);
  });

  it("одна со сроком, другая без — разные ключи (разные партии)", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15"));
    const b = nameKey(item("Чай зелёный", "Поставщик А", null));
    expect(a).not.toBe(b);
  });

  it("регистр не важен", () => {
    const a = nameKey(item("ЧАЙ ЗЕЛЁНЫЙ", "ПОСТАВЩИК А", "2026-01-15"));
    const b = nameKey(item("чай зелёный", "поставщик а", "2026-01-15"));
    expect(a).toBe(b);
  });

  it("лишние пробелы схлопываются", () => {
    const a = nameKey(item("  Чай   зелёный  ", "  Поставщик  А  ", "2026-01-15"));
    const b = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15"));
    expect(a).toBe(b);
  });

  it("ё → е", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15"));
    const b = nameKey(item("Чай зеленый", "Поставщик А", "2026-01-15"));
    expect(a).toBe(b);
  });

  it("пустая строка срока ↔ null — одинаковый ключ", () => {
    const a = nameKey(item("Чай", "А", ""));
    const b = nameKey(item("Чай", "А", null));
    expect(a).toBe(b);
  });

  it("разные даты поступления — разные ключи (две приёмки)", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15", "2026-03-01"));
    const b = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15", "2026-04-10"));
    expect(a).not.toBe(b);
  });

  it("одинаковые даты поступления — одинаковый ключ (дубль)", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15", "2026-03-01"));
    const b = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15", "2026-03-01"));
    expect(a).toBe(b);
  });

  it("без даты поступления и с датой — разные ключи", () => {
    const a = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15", null));
    const b = nameKey(item("Чай зелёный", "Поставщик А", "2026-01-15", "2026-03-01"));
    expect(a).not.toBe(b);
  });
});