/**
 * Черновая разведка: печатает сырые ячейки одного листа книги — нужна, чтобы
 * сверить статус строки («Выбыл») с тем, что лежит в data/shelf-data.json.
 * Не входит в проверку, только отладка.
 *
 * Запуск: node reports/dump-sheet.mjs <файл.xlsm> "<имя листа>" <с> <по>
 */
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const file = process.argv[2];
const wanted = process.argv[3] ?? "";
const from = Number(process.argv[4] ?? 1);
const to = Number(process.argv[5] ?? 20);

const book = XLSX.read(readFileSync(file), {
  type: "buffer",
  cellDates: true,
  cellNF: false,
  cellText: true,
});

const names = wanted ? book.SheetNames.filter((name) => name.includes(wanted)) : book.SheetNames;
for (const name of names) {
  console.log(`--- лист «${name}» ---`);
  const rows = XLSX.utils.sheet_to_json(book.Sheets[name], {
    header: 1,
    raw: false,
    defval: null,
    blankrows: true,
  });
  console.log(`строк: ${rows.length}`);
  rows.slice(from - 1, to).forEach((row, index) => {
    const cells = row
      .map((value, column) =>
        value === null || value === ""
          ? null
          : `${XLSX.utils.encode_col(column)}=${String(value).replace(/\n/g, "⏎")}`,
      )
      .filter(Boolean)
      .join(" | ");
    console.log(`${String(from + index).padStart(3)}: ${cells || "(пусто)"}`);
  });
}
