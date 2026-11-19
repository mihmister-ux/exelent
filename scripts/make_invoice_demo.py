# -*- coding: utf-8 -*-
"""Реалистичная накладная для демонстрации разбора (одного файла).

Воспроизводит структуру, которую описал заказчик:
  шапка с реквизитами (ИНН/КПП/адрес) — должна игнорироваться;
  таблица товаров с колонками № / Наименование / Код / Кол-во / Ед. / Цена / Сумма;
  колонка «Годен до» и итоговая строка — не товар, в журнал не попадает.

Запуск: python scripts/make_invoice_demo.py
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "накладная-демо.xlsx"


def main() -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Накладная"

    ws.append(["ООО «Лотос»"])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append(["ИНН 7726123456", "КПП 772601001"])
    ws.append(["123456, г. Москва, ул. Тверская, д. 1"])
    ws.append(["Поставщик: ООО Лотос"])
    ws.append(["Накладная № 451 от 12.11.2026"])
    ws.append([
        "№", "Наименование", "Код", "Кол-во", "Ед.",
        "Цена", "Сумма", "Годен до",
    ])
    header = 6

    rows = [
        (1, "Чай зелёный «Лотос», 100 г", "1001", 24, "шт", 120, 2880, date(2027, 3, 1)),
        (2, "Конфеты шоколадные «Белокуриха», 140 г", "1002", 12, "шт", 150, 1800, date(2026, 11, 20)),
        (3, "Чабрец, 50 г", "1003", 10, "уп", 50, 500, "05.12.2026"),
        (4, "Мёд алтайский, 250 г", "1004", 5, "бан", 200, 1000, "18.09..29"),
        (5, "Бальзам «Кавказский травник», 100 мл", "1005", 8, "шт", 250, 2000, date(2027, 1, 15)),
    ]
    for row in rows:
        ws.append(list(row))

    ws.append(["", "Итого", "", 59, "", "", 8180, ""])
    ws.cell(row=header + len(rows) + 1, column=2).font = Font(bold=True)
    ws.append(["Сдал ____________", "Принял ____________"])

    widths = [6, 46, 10, 10, 8, 10, 12, 14]
    for index, width in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + index)].width = width

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"{OUT.name}: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
