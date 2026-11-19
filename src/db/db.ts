import Dexie, { type Table } from "dexie";

import type { SettingRow, ShelfItem, Supplier } from "./types";
import { planSupplierLinks } from "./supplier-links";

/**
 * Локальная база в браузере: ни сервера, ни сети — как в «Гардеробе».
 * Склад работает с телефона, где интернет не гарантирован.
 */
export class ShelfDB extends Dexie {
  items!: Table<ShelfItem, string>;
  settings!: Table<SettingRow, string>;
  suppliers!: Table<Supplier, string>;

  constructor() {
    super("shelf-life");

    this.version(1).stores({
      // Индексы под то, что реально фильтруем: статус, поставщик, дата срока.
      items: "id, supplier, status, expiresAt, name, [status+expiresAt]",
      settings: "id",
    });

    // v2 — справочник поставщиков: имя/цвет/скрытость храним отдельно от позиций.
    this.version(2).stores({
      items: "id, supplier, status, expiresAt, name, [status+expiresAt]",
      settings: "id",
      suppliers: "id, name, hidden, order",
    });

    // v3 — привязка позиции к записи справочника (supplierId). Схема не
    // меняется: поле дозаписывается, индексы прежние. Для каждой позиции с
    // непустым поставщиком находим запись по имени и алиасам (или заводим
    // новую) и проставляем id.
    this.version(3).upgrade(async (tx) => {
      const items = (await tx.table("items").toArray()) as ShelfItem[];
      const suppliers = (await tx.table("suppliers").toArray()) as Supplier[];
      const plan = planSupplierLinks(items, suppliers, new Date().toISOString());
      if (plan.newSuppliers.length > 0) {
        await tx.table("suppliers").bulkPut(plan.newSuppliers);
      }
      await tx.table("items").bulkPut(plan.items);
    });
  }
}

export const db = new ShelfDB();
