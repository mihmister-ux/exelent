/** Черновая разведка: печатает сырые ячейки листа из fixtures — нужна, чтобы
 * понять, где в счёте 2804 сидит скидка 3%. Не входит в проверку, только отладка. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? join(here, "..", "fixtures", "Счет-2804.xlsx");
const from = Number(process.argv[3] ?? 1);
const to = Number(process.argv[4] ?? 45);

const book = XLSX.read(readFileSync(file), { type: "buffer", cellDates: true, cellNF: false, cellText: true });
for (const name of book.SheetNames) {
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
      .map((value, column) => (value === null || value === "" ? null : `${XLSX.utils.encode_col(column)}=${String(value).replace(/\n/g, "⏎")}`))
      .filter(Boolean)
      .join(" | ");
    if (cells) console.log(`${String(from + index).padStart(3)}: ${cells}`);
  });
}
