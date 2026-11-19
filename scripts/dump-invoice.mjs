import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const buf = readFileSync(process.argv[2]);
const book = XLSX.read(buf, { type: "buffer", cellDates: true, cellNF: false, cellText: true });

console.log("SHEETS:", book.SheetNames.join(" | "));

for (const name of book.SheetNames) {
  const sheet = book.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null, blankrows: true });
  console.log(`\n===== ${name} merges=${JSON.stringify(sheet["!merges"] ?? [])}`);
  rows.forEach((row, i) => {
    const cells = row.map((v) => (v === null || v === undefined ? "∅" : typeof v === "object" ? `<${v.constructor.name}>${String(v)}` : String(v)));
    console.log(String(i + 1).padStart(3), "|", cells.join(" ¦ "));
  });
}
