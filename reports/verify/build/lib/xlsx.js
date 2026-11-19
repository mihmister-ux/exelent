import * as XLSX from "xlsx";
/** Читает все листы книги. Ошибку формата отдаёт наверх — её покажем человеку. */
export async function readWorkbook(file) {
    const buffer = await file.arrayBuffer();
    const book = XLSX.read(buffer, {
        type: "array",
        cellDates: true,
        cellNF: false,
        // Форматированный текст ячейки — источник даты. cellDates:true сам по
        // себе даёт Date со сдвигом: 18.09.locale приезжает как 17.09 20:59 UTC.
        // А `w` у ячейки ровно то, что человек видит в Excel: "2026-09-18".
        cellText: true,
    });
    return book.SheetNames.map((name) => {
        const sheet = book.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            //raw:false => брать fmt-текст ячеек. Даты приходят как "2026-09-18",
            // числа — как строки; domain/invoice.ts справляется с обоими.
            raw: false,
            // Пустая ячейка — null, а не пропуск: иначе индексы колонок «съедут».
            defval: null,
            // Пустые строки тоже нужны: без них нельзя показать номер строки файла.
            blankrows: true,
        });
        expandMerges(rows, sheet["!merges"]);
        return { name, rows };
    });
}
/**
 * Раскрывает объединённые ячейки в сетку.
 *
 * В файле значение лежит только в левой верхней ячейке диапазона, остальные
 * пустые. Для разбора это ловушка: «Наименование», объединённое по вертикали
 * на две строки, терялось — вторая строка приходила без имени и попадала
 * в журнал пустой позицией. Человек в Excel видит текст во всём диапазоне —
 * сетка должна показывать то же.
 *
 * Заполняем только пустые ячейки: настоящие значения не перетираем.
 */
function expandMerges(rows, merges) {
    if (!merges?.length)
        return;
    for (const range of merges) {
        const source = rows[range.s.r]?.[range.s.c];
        if (source === null || source === undefined || String(source).trim() === "")
            continue;
        for (let r = range.s.r; r <= range.e.r; r += 1) {
            const row = rows[r];
            if (!row)
                continue;
            for (let c = range.s.c; c <= range.e.c; c += 1) {
                const value = row[c];
                if (value === null || value === undefined || String(value).trim() === "") {
                    row[c] = source;
                }
            }
        }
    }
}
