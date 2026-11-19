import openpyxl, sys

p = sys.argv[1]
wb = openpyxl.load_workbook(p, data_only=True)
for ws in wb.worksheets:
    print("SHEET", ws.title, ws.max_row, ws.max_column)
    print("MERGES", [str(m) for m in ws.merged_cells.ranges][:60])
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=min(ws.max_row, 100), values_only=True), 1):
        print(i, repr(row))
