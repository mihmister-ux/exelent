# -*- coding: utf-8 -*-
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
import openpyxl
wb = openpyxl.load_workbook(r"C:\Users\user\Desktop\Excel\reports\export-check.xlsx")

# без даты (пустой D) среди строк в наличии
for n in wb.sheetnames:
    ws = wb[n]
    nd = [r[0] for r in ws.iter_rows(min_row=2, values_only=True) if r[3] in (None, "")]
    print(n, "| без срока:", len(nd), "п/н:", nd[:6])

# «Честный знак»
print()
for n in wb.sheetnames:
    ws = wb[n]
    m = [(r[0], r[1][:30], r[7]) for r in ws.iter_rows(min_row=2, values_only=True) if r[7]]
    if m: print(n, "| честный знак:", m)