# -*- coding: utf-8 -*-
"""Валидация data/shelf-data.json. Печатает ASCII-safe отчёт, exit!=0 при провале."""
import json
import sys
import datetime as _dt
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(HERE, "data", "shelf-data.json")
TODAY = _dt.date(2026, 11, 12)

with open(P, encoding="utf-8") as fh:
    items = json.load(fh)

errors = []
checks = {}

checks["total"] = len(items)
if len(items) != 146:
    errors.append(f"total {len(items)} != 146")

ids = [it["id"] for it in items]
checks["unique_ids"] = len(set(ids))
if len(set(ids)) != len(ids):
    errors.append("duplicate ids")

checks["empty_names"] = sum(1 for it in items if not (it.get("name") or "").strip())
if checks["empty_names"]:
    errors.append(f"{checks['empty_names']} items without name")

suppliers = sorted({it["supplier"] for it in items})
checks["suppliers"] = suppliers
expected_suppliers = sorted([
    "ЛБренд Кавказский травник (ист1",
    "ГРИНФИТО ООО",
    "Две Линии",
    "Лотос ООО",
    "Пенталис",
    "Риф и Ко",
    "Алфит",
])
if suppliers != expected_suppliers:
    errors.append("supplier set mismatch")

checks["status"] = {}
for it in items:
    checks["status"][it["status"]] = checks["status"].get(it["status"], 0) + 1
if checks["status"].get("sold") != 16:
    errors.append(f"sold {checks['status'].get('sold')} != 16")

n_date = sum(1 for it in items if it["expiresAt"])
n_note = sum(1 for it in items if (it.get("note") or "").startswith("expires_raw="))
n_empty = len(items) - n_date - n_note
checks.update(date=n_date, note=n_note, empty=n_empty)
if (n_date, n_note, n_empty) != (102, 1, 43):
    errors.append(f"date/note/empty {(n_date, n_note, n_empty)} != (102,1,43)")

buckets = {"expired": 0, "soon": 0, "warning": 0, "ok": 0}
for it in items:
    if not it["expiresAt"]:
        continue
    d = _dt.date.fromisoformat(it["expiresAt"])
    if d < TODAY:
        buckets["expired"] += 1
    elif d <= TODAY + _dt.timedelta(days=30):
        buckets["soon"] += 1
    elif d <= TODAY + _dt.timedelta(days=60):
        buckets["warning"] += 1
    else:
        buckets["ok"] += 1
checks["buckets"] = buckets
if buckets != {"expired": 1, "soon": 2, "warning": 0, "ok": 99}:
    errors.append(f"buckets {buckets} != expected")

# строки без срока на Две Линии (объединённые B:V)
dl_no_date = [it["id"] for it in items if it["supplier"] == "Две Линии" and not it["expiresAt"]]
checks["dl_no_date"] = dl_no_date

# sample продано
sold_sample = [it["id"] for it in items if it["status"] == "sold"][:3]
checks["sold_sample"] = sold_sample

checks["ok"] = not errors
checks["errors"] = errors
print(json.dumps(checks, ensure_ascii=True))
sys.exit(0 if not errors else 1)