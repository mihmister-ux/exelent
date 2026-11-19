import * as XLSX from "xlsx";

/**
 * Чтение книги Excel в браузере — без сервера и без отправки файла наружу.
 *
 * Нам нужен не «умный» разбор, а честная сетка значений: строка → массив
 * ячеек, где даты уже настоящие Date, а не числа-сериалы. Всё остальное
 * (где в этой сетке таблица товаров) решает domain/invoice.ts — там логика
 * без зависимости от библиотеки, её можно покрыть тестами.
 */

export interface SheetGrid {
  /** Имя листа, как в книге. */
  name: string;
  /**
   * Строки листа, индекс 0 — первая строка файла. Ячейка — форматированный
   * текст (даты уже "YYYY-MM-DD") или null. Пустые строки сохранены: по
   * индексу считается настоящий номер строки Excel, он нужен в предпросмотре.
   */
  rows: unknown[][];
}

/**
 * Расширения, которые реально прочитает SheetJS. `.xls` — старый двоичный
 * формат (BIFF), `.xlsx`/`.xlsm` — zip с XML. Библиотека определяет формат по
 * сигнатуре в начале файла, а не по имени, поэтому один путь чтения покрывает
 * оба; список нужен для того, чтобы пускать файл в чтение и рассказать человеку,
 * что мы ждём.
 */
export const EXCEL_EXTENSIONS = ["xlsx", "xls", "xlsm"] as const;

/** Есть ли в имени файла расширение Excel (§ проверка до чтения). */
export function isExcelName(name: string): boolean {
  return new RegExp(`\\.(${EXCEL_EXTENSIONS.join("|")})$`, "i").test(name);
}

/** Тот же текст показываем и на нечитаемом файле, и в подсказке под кнопкой. */
export const UNREADABLE_FILE =
  "Не удалось прочитать файл. Пересохраните его в формате .xlsx или .xls";

/**
 * Сигнатура книги — первые байты файла:
 * `PK` — OOXML (.xlsx/.xlsm — это zip), `D0 CF 11 E0` — OLE2/.xls (BIFF8).
 *
 * Проверка нужна именно до чтения: на мусоре SheetJS ошибку не бросает —
 * молча возвращает книгу с одним пустым листом «Sheet1». Дальше parseInvoice
 * не нашёл бы таблицу товаров, и человек получил бы неверный совет «проверьте
 * колонки Наименование и Кол-во» вместо «файл не читается».
 */
function looksLikeExcel(buffer: ArrayBuffer): boolean {
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (head.length < 4) return false;

  const zip = head[0] === 0x50 && head[1] === 0x4b;
  const ole2 =
    head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  return zip || ole2;
}

/**
 * Читает все листы книги. Ошибку формата отдаёт наверх — её покажем человеку.
 *
 * @throws Error с текстом UNREADABLE_FILE, если файл повреждён или это не
 * книга Excel. Наверху этот текст показывается как есть — без «Error: …»
 * и стектрейса, человеку нужно действие, а не подробности разбора.
 */
export async function readWorkbook(file: File): Promise<SheetGrid[]> {
  const buffer = await file.arrayBuffer();

  if (!looksLikeExcel(buffer)) throw new Error(UNREADABLE_FILE);

  let book: XLSX.WorkBook;
  try {
    // Один вызов на оба формата: SheetJS смотрит на сигнатуру (D0 CF 11 E0 у
    // .xls, PK у .xlsx) — поэтому .xls и .xlsm идут тем же путём, без ветвления.
    book = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      cellNF: false,
      // Форматированный текст ячейки — источник даты. cellDates:true сам по
      // себе даёт Date со сдвигом: 18.09.locale приезжает как 17.09 20:59 UTC.
      // А `w` у ячейки ровно то, что человек видит в Excel: "2026-09-18".
      cellText: true,
    });
  } catch {
    // Библиотека бросает свои ошибки («Unsupported file»…), английские и
    // технические. Наружу уходит одна понятная фраза.
    throw new Error(UNREADABLE_FILE);
  }

  // Книга без единого листа — тоже «не читается»: parseInvoice вернул бы null,
  // и человек увидел бы «не нашёл таблицу товаров», что неправда.
  if (book.SheetNames.length === 0) throw new Error(UNREADABLE_FILE);

  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
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
function expandMerges(rows: unknown[][], merges: XLSX.Range[] | undefined): void {
  if (!merges?.length) return;

  for (const range of merges) {
    const source = rows[range.s.r]?.[range.s.c];
    if (source === null || source === undefined || String(source).trim() === "") continue;

    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const row = rows[r];
      if (!row) continue;
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const value = row[c];
        if (value === null || value === undefined || String(value).trim() === "") {
          row[c] = source;
        }
      }
    }
  }
}
