/**
 * Генерирует тестовый счёт в PDF без внешних зависимостей.
 *
 * Нужен именно «накладная-подобный» файл: шапка с реквизитами, заголовок
 * таблицы, строка нумерации колонок, позиции и итоги. Так проверяется, что
 * PDF-путь проходит те же ловушки, что и Excel-путь.
 */
import { writeFileSync } from "node:fs";

/** WinAnsi-безопасный текст: кириллицу в PDF строкой не запишешь без шрифта. */
const esc = (text) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function content(lines) {
  const parts = ["BT", "/F1 9 Tf", "11 TL"];
  let first = true;
  for (const line of lines) {
    if (first) parts.push(`1 0 0 1 ${line.x} ${line.y} Tm`);
    else parts.push(`1 0 0 1 ${line.x} ${line.y} Tm`);
    parts.push(`(${esc(line.text)}) Tj`);
    first = false;
  }
  parts.push("ET");
  return parts.join("\n");
}

const lines = [];
let y = 760;
const push = (x, text, dy = 0) => lines.push({ x, y: y - dy, text });

// Шапка: реквизиты (парсер обязан их пропустить).
// Заголовки транслитом: Type1-шрифт без кириллицы, а для проверки сетки
// важны не буквы, а слова-алиасы («наименование», «кол-во», «цена», «сумма»).
push(60, "Postavshchik: Farm Zavod Galen LLC");
push(60, "INN 2224031168  KPP 222101001", 12);
push(60, "656011, Altayskiy kray, Barnaul, Matrosova 13", 12);
push(60, "Nakladnaya No 2804 ot 26.10.2026", 24);
y -= 48;

// Заголовок таблицы и нумерация колонок — как в реальном счёте.
const COLS = [60, 95, 140, 340, 395, 425, 460, 520];
push(COLS[0], "No");
push(COLS[1], "Kod");
push(COLS[2], "Naimenovanie");
push(COLS[3], "Kol-vo");
push(COLS[4], "Ed.");
push(COLS[5], "Tsena");
push(COLS[6], "Summa");
push(COLS[7], "Goden do");
y -= 12;

push(COLS[0], "1");
push(COLS[1], "4");
push(COLS[2], "5");
push(COLS[3], "6");
push(COLS[4], "7");
push(COLS[5], "8");
y -= 14;

const goods = [
  ["1", "4660000647252", "Pantalfit-5 Premium for joints, 30 bricks x 2g", "5", "pcs", "365.00", "1825.00", "18.09.2027"],
  ["2", "4660000647269", "Pantalfit-6 Premium, 30 bricks x 2g", "5", "pcs", "356.00", "1780.00", "18.09.2027"],
  ["3", "4660000642547", "Sirop 9 Trav dlya glaz 250 ml", "5", "pcs", "189.00", "945.00", "01.02.2027"],
  ["4", "4660000642608", "Sirop 9 Trav dlya pecheni 250 ml", "5", "pcs", "189.00", "945.00", "01.02.2027"],
  ["5", "4660000642585", "Sirop 9 Trav dlya pochek 250 ml", "5", "pcs", "189.00", "945.00", "01.02.2027"],
  ["6", "4660000642578", "Sirop 9 Trav dlya serdtsa 250 ml", "5", "pcs", "189.00", "945.00", "01.02.2027"],
  ["7", "4660000642592", "Sirop 9 Trav dlya sustavov 250 ml", "5", "pcs", "189.00", "945.00", "01.02.2027"],
  ["8", "4660000642875", "BALZAM ALTAY USPOKAIVAYUSHCHIY", "5", "pcs", "280.00", "1400.00", "18.09..29"],
  ["9", "4660000641946", "Balzam zhenskiy (steklo)", "5", "pcs", "266.00", "1330.00", "01.12.2027"],
  ["10", "4660000641939", "Balzam muzhskoy (steklo)", "5", "pcs", "266.00", "1330.00", "01.12.2027"],
];

for (const g of goods) {
  for (let i = 0; i < g.length; i += 1) push(COLS[i], g[i]);
  y -= 13;
}

// Итоги и подписи — парсер должен остановиться здесь.
y -= 6;
push(COLS[2], "Total");
push(COLS[6], "13390.00");
y -= 16;
push(60, "Director ______________");
y -= 12;
push(60, "Chief accountant ______________");

const body = content(lines);
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
];

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i += 1) {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}

const xref = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i += 1) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const target = process.argv[2] ?? "fixtures/invoice-2804.pdf";
writeFileSync(target, Buffer.from(pdf, "latin1"));
console.log(`written ${target}`);
