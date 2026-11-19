# -*- coding: utf-8 -*-
"""
Этап 1 — импорт журнала «Учёт сроков хранения.xlsm» в чистый JSON.
Исходник ТОЛЬКО читается (data_only), ничего не перезаписывается.
Результат: data/shelf-data.json + reports/import-report.md
"""
import json
import os
import datetime as _dt

from openpyxl import load_workbook

SRC = r"C:\Users\user\Desktop\Учёт сроков хранения.xlsm"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(HERE, "data", "shelf-data.json")
OUT_REPORT = os.path.join(HERE, "reports", "import-report.md")

# Снимок брифа: 12.11.2026 (дата анализа). В приложении "сегодня" = runtime.
TODAY = _dt.date(2026, 11, 12)

DATE_FORMATS = [
    "%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y",
    "%m/%d/%Y", "%Y.%m.%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
]


def norm(v):
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return v


def to_date(v):
    """Возвращает ('empty',None) | ('date',date) | ('text',str) | ('other',repr)."""
    v = norm(v)
    if v is None:
        return ("empty", None)
    if isinstance(v, _dt.datetime):
        return ("date", v.date())
    if isinstance(v, _dt.date):
        return ("date", v)
    if isinstance(v, str):
        s = v.strip()
        for fmt in DATE_FORMATS:
            try:
                return ("date", _dt.datetime.strptime(s, fmt).date())
            except ValueError:
                pass
        return ("text", s)
    if isinstance(v, (int, float)):
        try:
            from openpyxl.utils.datetime import from_excel
            return ("date", from_excel(v).date())
        except Exception:
            return ("other", v)
    return ("other", v)


def readcell(ws, r, c):
    """Значение ячейки с учётом объединённых диапазонов.

    Особый случай «Две Линии»: объединение B:V (имя товара растянуто на весь
    ряд) — все колонки правее B в этом диапазоне считаются пустыми, иначе
    наименование ошибочно читается как дата/остаток.
    """
    val = ws.cell(row=r, column=c).value
    if val is not None and not (isinstance(val, str) and val.strip() == ""):
        return val
    for mr in ws.merged_cells.ranges:
        if mr.min_row <= r <= mr.max_row and mr.min_col <= c <= mr.max_col:
            # диапазон заякорен на B и тянется вправо => это «имя на всю строку»
            if mr.min_col == 2 and c != 2:
                return None
            v = ws.cell(row=mr.min_row, column=mr.min_col).value
            if v is not None:
                return v
    return ws.cell(row=r, column=c).value


def iso(d):
    return d.isoformat() if d else None


def main():
    wb = load_workbook(SRC, data_only=True, keep_vba=False, read_only=False)
    wbf = load_workbook(SRC, data_only=False, keep_vba=False, read_only=False)

    items = []
    per_sheet = []  # list of dict for report table

    for si, name in enumerate(wb.sheetnames):
        ws = wb[name]
        wsf = wbf[name]
        # листы размечены до 1003, данные реально до ~35; берём max_row целиком
        rows = []
        for r in range(4, ws.max_row + 1):
            b = norm(readcell(ws, r, 2))      # B наименование
            d_raw = readcell(ws, r, 4)        # D годен до
            kind, dval = to_date(d_raw)

            # товарная строка = есть наименование ИЛИ есть хоть что-то в D
            if b is None and kind == "empty":
                continue

            c_kind, c_val = to_date(readcell(ws, r, 3))  # C поступление
            e = norm(readcell(ws, r, 5))      # E остаток
            g = norm(readcell(ws, r, 7))      # G выбыл
            h = norm(readcell(ws, r, 8))      # H честный знак
            i = norm(readcell(ws, r, 9))      # I дата акта
            f_cache = norm(readcell(ws, r, 6))       # F (кэш формулы)
            f_formula = wsf.cell(row=r, column=6).value  # формула как текст

            status = "in_stock"
            if g is not None:
                gl = str(g).lower()
                if "продан" in gl:
                    status = "sold"
                elif "списан" in gl:
                    status = "written_off"

            marked = False
            if h is not None:
                hmm = str(h).strip()
                marked = hmm in ("*", "×", "x", "X", "✓", "+") or hmm != ""

            note = None
            expires = None
            if kind == "date":
                expires = iso(dval)
            elif kind in ("text", "other"):
                note = f"expires_raw={d_raw!r}"

            item = {
                "id": f"s{si + 1:02d}r{r:03d}",
                "name": b,
                "supplier": name,
                "receivedAt": iso(c_val) if c_kind == "date" else None,
                "expiresAt": expires,
                "marked": marked,
                "status": status,
                "soldAt": None,
                "note": note,
            }
            items.append(item)
            rows.append({
                "row": r,
                "name": item["name"],
                "d_kind": kind,
                "d_val": dval,
                "c_kind": c_kind,
                "status": status,
                "f_cache": f_cache,
                "f_has_formula": isinstance(f_formula, str) and f_formula.startswith("="),
            })

        # классификация по D
        stat = {"rows": len(rows)}
        for k in ("date", "text", "empty", "other"):
            stat[k] = sum(1 for x in rows if x["d_kind"] == k)
        stat["received"] = sum(1 for x in rows if x["c_kind"] == "date")
        stat["sold"] = sum(1 for x in rows if x["status"] == "sold")
        stat["f_cached"] = sum(1 for x in rows if x["f_cache"] not in (None, ""))
        stat["f_formula_in_product_row"] = sum(1 for x in rows if x["f_has_formula"])
        per_sheet.append({"sheet": name, "stat": stat, "rows": rows})

    # Контрольные суммы
    total = len(items)
    n_date = sum(1 for it in items if it["expiresAt"] is not None)
    n_text = sum(1 for it in items if (it["note"] or "").startswith("expires_raw="))
    n_empty = sum(1 for it in items if it["expiresAt"] is None and not (it["note"] or "").startswith("expires_raw="))
    n_sold = sum(1 for it in items if it["status"] == "sold")

    # Бакеты по сроку (только валидные даты)
    buckets = {"expired": [], "soon": [], "warning": [], "ok": []}
    for it in items:
        if not it["expiresAt"]:
            continue
        d = _dt.date.fromisoformat(it["expiresAt"])
        if d < TODAY:
            buckets["expired"].append(it)
        elif d <= TODAY + _dt.timedelta(days=30):
            buckets["soon"].append(it)
        elif d <= TODAY + _dt.timedelta(days=60):
            buckets["warning"].append(it)
        else:
            buckets["ok"].append(it)
    no_date = [it for it in items if it["expiresAt"] is None]

    # ---- запись JSON ----
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(items, fh, ensure_ascii=False, indent=2)

    # ---- отчёт ----
    os.makedirs(os.path.dirname(OUT_REPORT), exist_ok=True)
    L = []
    A = L.append
    A("# Отчёт по импорту — «Учёт сроков хранения.xlsm»")
    A("")
    A(f"- Источник (только чтение): `{SRC}`")
    A(f"- Дата анализа (снимок): 2026-11-12")
    A(f"- Всего товарных строк: **{total}**")
    A("")
    A("## Контрольные суммы")
    A("")
    A("| Контроль | Факт | Ожидание (бриф) |")
    A("|---|---:|---:|")
    A(f"| Всего строк | {total} | 146 |")
    A(f"| С датой (годен до) | {n_date} | 102 |")
    A(f"| Без даты (пусто) | {n_empty} | 43 |")
    A(f"| Текст вместо даты | {n_text} | 1 |")
    A(f"| Продано (G) | {n_sold} | 16 |")
    A("")
    A("## По листам")
    A("")
    A("| Лист | Строк | дата | текст | пусто | поступл. | продано | F-форм. в строке |")
    A("|---|---:|---:|---:|---:|---:|---:|---:|")
    for ps in per_sheet:
        s = ps["stat"]
        A(f"| `{ps['sheet']}` | {s['rows']} | {s['date']} | {s['text']} | {s['empty']} | {s['received']} | {s['sold']} | {s['f_formula_in_product_row']} |")
    A("")
    A("> F-форм. в строке — в скольких товарных строках колонка F реально содержит формулу.")
    A("> Ожидание по брифу (дефект №1): 10 только у `Риф и Ко`, у остальных 0 (формулы ниже данных).")
    A("")
    A("## Сроки (относительно 2026-11-12)")
    A("")
    A(f"- Просрочено: **{len(buckets['expired'])}**")
    A(f"- Истекает ≤30 дней: **{len(buckets['soon'])}**")
    A(f"- Истекает 31–60 дней: **{len(buckets['warning'])}**")
    A(f"- Всё остальное (61+): **{len(buckets['ok'])}**")
    A(f"- Без срока (пусто + текст): **{len(no_date)}**")
    A("")
    if buckets["expired"]:
        A("### Просрочено")
        for it in buckets["expired"]:
            A(f"- `{it['supplier']}` строка {it['id'].split('r')[-1]}: {it['name']} — годен до {it['expiresAt']}")
    if buckets["soon"]:
        A("")
        A("### Истекает ≤30 дней")
        for it in buckets["soon"]:
            A(f"- `{it['supplier']}` строка {it['id'].split('r')[-1]}: {it['name']} — годен до {it['expiresAt']}")
    if buckets["warning"]:
        A("")
        A("### Истекает 31–60 дней")
        for it in sorted(buckets["warning"], key=lambda x: x["expiresAt"]):
            A(f"- `{it['supplier']}` строка {it['id'].split('r')[-1]}: {it['name']} — годен до {it['expiresAt']}")
    A("")
    if n_text:
        A("## Строки с текстом вместо даты (нужно решить вручную)")
        for it in items:
            if (it["note"] or "").startswith("expires_raw="):
                A(f"- `{it['supplier']}` {it['id'].split('r')[-1]}: {it['name']} → {it['note']}")
    A("")
    A("## Артефакты")
    A("")
    A(f"- `{OUT_JSON}`")
    A(f"- `{OUT_REPORT}`")

    with open(OUT_REPORT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))

    # краткий ASCII-safe вывод в stdout (кириллица экранирована)
    summary = {
        "total": total,
        "date": n_date,
        "empty": n_empty,
        "text": n_text,
        "sold": n_sold,
        "buckets": {k: len(v) for k, v in buckets.items()},
        "no_date": len(no_date),
    }
    print(json.dumps(summary, ensure_ascii=True))


if __name__ == "__main__":
    main()