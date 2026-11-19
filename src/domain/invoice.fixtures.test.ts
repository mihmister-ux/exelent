/// <reference types="node" />
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseInvoice } from "@/domain/invoice";
import { readWorkbook } from "@/lib/xlsx";

/**
 * Золотой тест на реальных фикстурах (аудит п.29).
 *
 * Тесты `invoice.test.ts` проверяют разбор на синтетических сетках — они не
 * ловят регрессии на настоящих файлах: именно поэтому обрыв таблицы на слове
 * внутри названия и потеря листов прожили в коде так долго. Здесь каждый файл
 * из `fixtures/` разбирается целиком, а результат сверяется снапшотом.
 *
 * Снапшот намеренно «сжатый»: только то, что человек увидит в предпросмотре и
 * что важно для журнала. Служебные поля (номер строки, лист) в него не идут —
 * иначе любая правка нумерации давала бы шум вместо сигнала.
 */

const FIXTURES = join(process.cwd(), "fixtures");

/** Только книги Excel: PDF требует pdfjs с worker, ему в node-тестах не место. */
const EXCEL_FILES = existsSync(FIXTURES)
  ? readdirSync(FIXTURES)
      .filter((name: string) => /\.(xlsx|xlsm)$/i.test(name))
      .sort()
  : [];

/** Что именно фиксируем от каждой позиции. */
function compact(row: {
  name: string;
  supplier: string;
  expiresAt: string | null;
  rawExpires: string | null;
  quantity: string;
  unit: string;
  price: string;
  amount: string;
  warning: string | null;
}) {
  return {
    name: row.name,
    supplier: row.supplier,
    expiresAt: row.expiresAt,
    rawExpires: row.rawExpires,
    quantity: row.quantity,
    unit: row.unit,
    price: row.price,
    amount: row.amount,
    warning: row.warning,
  };
}

describe.skipIf(EXCEL_FILES.length === 0)("золотой тест: фикстуры Excel", () => {
  for (const file of EXCEL_FILES) {
    it(`разбирает «${file}»`, async () => {
      const buffer = readFileSync(join(FIXTURES, file));
      const sheets = await readWorkbook(new File([buffer], file));
      const result = parseInvoice(sheets);

      // Книга может не содержать таблицы товаров — это законный результат.
      if (!result) {
        expect(result).toBeNull();
        return;
      }

      const snapshot = {
        supplier: result.supplier,
        documentDate: result.documentDate,
        confidence: result.confidence,
        sheetCount: result.sheets.length,
        rows: result.rows.map(compact),
      };

      expect(snapshot).toMatchSnapshot();
    });
  }
});
