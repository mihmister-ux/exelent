"""Учебные накладные для проверки разбора файлов (.xlsx).

Файлы нужны тестам и ручной проверке в браузере: в них воспроизведены те же
случаи, что встречаются в настоящих накладных поставщиков:

* дата в ячейке как настоящая дата Excel (тип datetime);
* дата строкой «01.02.2027»;
* битая дата «18.09..29» — распознать нельзя, исходный текст надо сохранить;
* поставщик и в колонке, и вовсе без колонки (тогда его спросят у человека);
* пустой лист, который разбор обязан пропустить.

Запуск: python scripts/make_invoice_fixture.py
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures"


def build_with_supplier() -> Path:
    book = Workbook()
    sheet = book.active
    sheet.title = "Товары"

    sheet.append(["Накладная № 451 от 12.11.2026"])          # 1: шапка документа
    sheet.append(["Наименование", "Поставщик", "Годен до", "Количество"])  # 2: заголовки
    sheet.append(["Конфеты шоколадные, 140 г", "Лотос", date(2026, 9, 18), 24])
    sheet.append(["Чабрец, 50 г", "Новый Поставщик", "01.02.2027", 10])
    sheet.append(["Мёд алтайский, 250 г", "Алфит", "18.09..29", 5])

    book.create_sheet("Лист1")  # 3: пустой лист — в разбор попасть не должен

    path = FIXTURES / "invoice-lotos.xlsx"
    book.save(path)
    return path


def build_without_supplier() -> Path:
    book = Workbook()
    sheet = book.active
    sheet.title = "Накладная"

    sheet.append(["Наименование", "Срок годности"])  # без колонки поставщика
    sheet.append(["Зайчик травяной, 30 г", date(2026, 12, 1)])
    sheet.append(["Ромашка, 100 г", "05.03.2027"])

    path = FIXTURES / "invoice-no-supplier.xlsx"
    book.save(path)
    return path


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for path in (build_with_supplier(), build_without_supplier()):
        print(f"{path.name}: {path.stat().st_size} байт")


if __name__ == "__main__":
    main()
