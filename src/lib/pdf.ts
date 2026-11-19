import type { SheetGrid } from "@/lib/xlsx";

/**
 * Чтение текстового PDF в ту же сетку, что даёт Excel.
 *
 * Здесь только геометрия: где на странице лежит текст и как из этих кусочков
 * собрать строки и колонки. Никакой логики накладной — её по-прежнему делает
 * domain/invoice.ts, получая обычный SheetGrid. Поэтому PDF и .xlsx идут
 * одним путём: один предпросмотр, одни тесты, одно поведение.
 *
 * Работает в браузере (worker из node_modules, файл никуда не уходит) и
 * в тестах/скриптах (legacy-сборка, без DOM).
 */

/** Расширенная сетка: кроме строк даёт ширины колонок для склейки в строку. */
export interface PdfGrid extends SheetGrid {
  /** Сколько страниц реально прочитано. */
  pages: number;
  /** Если в PDF нет текстового слоя — true (скан), и разбирать нечего. */
  looksScanned: boolean;
}

type PdfTextItem = {
  str: string;
  /** Матрица преобразования: [a, b, c, d, e, f]; x = e, y = f (в PDF-координатах). */
  transform: number[];
  width: number;
  height: number;
};

interface PlacedCell {
  x: number;
  right: number;
  text: string;
}

interface Line {
  /** Y в координатах «сверху вниз», чтобы порядок совпадал со строками Excel. */
  y: number;
  cells: PlacedCell[];
}/**
 * Группировка по Y. Допуск нужен, потому что в одной визуальной строке
 * куски часто стоят на высотах, отличающихся на 1–2 pt (шрифты разного
 * кегля). Слишком маленький допуск рвёт строку, слишком большой — склеивает
 * соседние строки таблицы.
 */
const Y_TOLERANCE = 3.5;

/**
 * Допуск по левому краю: насколько числа одной колонки могут начинаться
 * не в одной точке. Числа колонки выровнены по своему полю, поэтому их левые
 * края почти совпадают; соседние колонки отстоят заметно дальше.
 */
const COLUMN_LEFT_TOLERANCE = 3;

/**
 * Сколько РАЗНЫХ строк должно стоять на одном левом крае, чтобы это был столбец.
 *
 * Три, а не два: пара чисел из шапки (номер счёта, БИК) может случайно совпасть
 * по X и породить ложный столбец, который отбирает у «Кол-ва» его заголовок.
 * Настоящая колонка повторяется на каждой позиции. Если после такого отсева
 * столбцов осталось меньше двух — документ маленький, порог ослабляется.
 */
const COLUMN_MIN_LINES = [4, 3, 2] as const;

/** Текстовый столбец («Наименование») виден по повтору на многих строках. */
const TEXT_COLUMN_MIN_LINES = 3;

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Достаёт из PDF текст с координатами и раскладывает его по строкам.
 *
 * Важно: `getTextContent()` отдаёт куски в порядке содержимого потока, а не
 * визуальном. Для таблиц этого мало — нужен сортировка по координатам.
 */
function buildLines(items: PdfTextItem[], pageHeight: number): Line[] {
  const placed: Array<{ x: number; y: number; right: number; text: string }> = [];

  for (const item of items) {
    const text = item.str.replace(/\u00a0/g, " ").trim();
    if (!text) continue;
    const x = item.transform[4];
    const y = pageHeight - item.transform[5];
    const width = Math.abs(item.width) || 0;
    placed.push({ x, y, right: x + width, text });
  }

  if (placed.length === 0) return [];

  // Сверху вниз, затем слева направо — так получается читаемый порядок.
  placed.sort((a, b) => (Math.abs(a.y - b.y) > Y_TOLERANCE ? a.y - b.y : a.x - b.x));

  const lines: Line[] = [];
  for (const piece of placed) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(piece.y - line.y) <= Y_TOLERANCE) {
      line.cells.push({ x: piece.x, right: piece.right, text: piece.text });
      // Высота строки — средневзвешенная по кускам, иначе «1» и «Наименование»
      // тянут допуск в разные стороны и строка рвётся на следующем куске.
      line.y = (line.y * (line.cells.length - 1) + piece.y) / line.cells.length;
    } else {
      lines.push({ y: piece.y, cells: [{ x: piece.x, right: piece.right, text: piece.text }] });
    }
  }

  for (const line of lines) line.cells.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Собирает из строк разреженную сетку: ячейка ставится в колонку по X.
 *
 * Колонки определяются по всем строкам сразу (объединение стартов) — иначе
 * накладная, где цена в первой строке стоит на 300 pt, а в остальных на
 * 305, распалась бы на две колонки и «Цена × Кол-во ≠ Сумма» на каждой строке.
 */
function toGrid(lines: Line[], columns: ColumnSpan[]): Array<{ row: unknown[]; y: number }> {
  return lines.map((line) => {
    const row: unknown[] = Array.from({ length: columns.length }, () => null);
    for (const cell of line.cells) {
      const index = columnIndexFor(cell, columns);
      const existing = row[index];
      row[index] = existing === null || existing === undefined ? cell.text : `${String(existing)} ${cell.text}`;
    }
    return { row, y: line.y };
  });
}

/**
 * Столбцы таблицы — ТОЛЬКО из левых краёв числовых ячеек.
 *
 * Числа задают сетку, потому что выровнены по своему полю: все количества
 * начинаются в одной точке, все цены — в другой. Левый край при этом надёжнее
 * центра: «5» и «8 600,00» стоят в одной колонке, но их центры расходятся на
 * сорок пунктов, а левые края совпадают.
 *
 * Именно на центрах ломался прошлый вариант. Он сшивал числа по центрам и
 * сравнивал каждое со СЛЕДУЮЩИМ, а не с началом колонки, поэтому широкое число
 * тянуло за собой соседа: 13-значный код сливался с количеством, а «Кол-во»,
 * «Ед.» и «Цена» съезжались в одну ячейку «Кол-во Ед. Цена». Отсюда и путаница
 * «Код / Кол-во / Цена».
 *
 * Текстовые ячейки (названия, заголовки, «шт») столбцов не создают — они потом
 * попадают в тот числовой столбец, с которым сильнее перекрываются по
 * горизонтали. Так «Наименование» встаёт перед кодом, а единица измерения —
 * между количеством и ценой, ровно там, где они стоят на странице.
 */
interface ColumnSpan {
  left: number;
  right: number;
}

/** Числовая ячейка: только цифры и разделители — ни букв, ни знаков валют. */
function isNumericText(text: string): boolean {
  return /^[\d\s.,-]+$/.test(text);
}

interface PlacedEntry {
  cell: PlacedCell;
  /** Номер визуальной строки: по нему считается, повторяется ли край. */
  line: number;
}

/**
 * Левые края, повторяющиеся хотя бы на `minLines` строках.
 *
 * Каждое число сравнивается с НАЧАЛОМ своей группы, а не с предыдущим числом:
 * иначе цепочка «каждое следующее чуть правее» протаскивает в один столбец
 * полстраницы.
 */
function repeatedAnchors(entries: PlacedEntry[], minLines: number): ColumnSpan[] {
  const sorted = [...entries].sort((a, b) => a.cell.x - b.cell.x);

  const groups: Array<{ left: number; right: number; lines: Set<number> }> = [];
  for (const entry of sorted) {
    const group = groups[groups.length - 1];
    if (group && entry.cell.x - group.left <= COLUMN_LEFT_TOLERANCE) {
      group.lines.add(entry.line);
      group.right = Math.max(group.right, entry.cell.right);
    } else {
      groups.push({ left: entry.cell.x, right: entry.cell.right, lines: new Set([entry.line]) });
    }
  }

  return groups
    .filter((group) => group.lines.size >= minLines)
    .map((group) => ({ left: group.left, right: group.right }));
}

/**
 * Сливает полосы с одинаковым левым краем и делит страницу на столбцы.
 *
 * Правый край каждого столбца обрезается по левому краю следующего. Без этого
 * одна широкая строка (подпись, примечание на всю страницу) растягивала свой
 * столбец на весь лист, и правило «кто сильнее перекрылся» отправляло в него
 * вообще все ячейки — сетка складывалась в одну колонку.
 */
function mergeAnchors(anchors: ColumnSpan[]): ColumnSpan[] {
  const sorted = [...anchors].sort((a, b) => a.left - b.left);
  const merged: ColumnSpan[] = [];

  for (const anchor of sorted) {
    const last = merged[merged.length - 1];
    if (last && anchor.left - last.left <= COLUMN_LEFT_TOLERANCE) {
      last.right = Math.max(last.right, anchor.right);
    } else {
      merged.push({ ...anchor });
    }
  }

  for (let index = 0; index < merged.length - 1; index += 1) {
    merged[index].right = Math.min(merged[index].right, merged[index + 1].left);
  }

  return merged;
}

/**
 * Текстовый якорь — заголовок числового столбца, если начинается там же, где
 * начинаются его числа.
 *
 * Сравнивать надо именно ЛЕВЫЙ КРАЙ, а не перекрытие полос. Заголовок стоит над
 * своим полем и обычно шире своих цифр: «Qty» (340..354) шире столбца пятёрок
 * (340..345), а 13-значный код (95..160) шире слова «Code» (95..116) наоборот.
 * Проверка «полосы не пересекаются» выбрасывала оба случая: заголовок «Code»
 * уезжал в столбец кода, тянул туда наименование, и строка шапки склеивалась в
 * «Code Name». Совпадение левых краёв различает их безошибочно: у настоящего
 * текстового столбца («Наименование») числа стоят в другом месте.
 */
function isSameStart(anchor: ColumnSpan, column: ColumnSpan): boolean {
  return Math.abs(anchor.left - column.left) <= COLUMN_LEFT_TOLERANCE;
}

/**
 * Сколько числовых ячеек в строке говорит, что это строка таблицы.
 *
 * Четыре, потому что настоящая позиция накладной заполняет код, количество,
 * цену и сумму. Реквизиты шапки («ИНН 0400001746 КПП 040001001 р/с …») дают
 * не больше трёх чисел, а их левые края случайно попадают в те же точки, что у
 * колонок товаров, — и без отсева они порождают фальшивые столбцы, которые
 * перехватывают заголовки («Кол-во» уезжало в столбец реквизитов, количество
 * съезжало на две колонки вправо).
 */
const TABLE_ROW_MIN_NUMBERS = 4;

/**
 * Вертикальная полоса таблицы — от первой до последней строки, заполненной
 * числами как позиция накладной.
 *
 * Столбцы ищутся только внутри этой полосы: реквизиты и подписи лежат выше и
 * ниже таблицы, к её сетке они отношения не имеют. Без такого ограничения
 * счёт с длинной шапкой (банк, ИНН, КПП, адреса) разъезжался: часть колонок
 * приходила из шапки.
 *
 * `null` — полоса не опознана (таблица из одной-двух колонок, где строка
 * позиции не набирает четырёх чисел). Тогда ограничения нет и работает
 * прежнее поведение: сетка строится по всем ячейкам страницы.
 */
function tableBand(lines: Line[]): { first: number; last: number } | null {
  let first = -1;
  let last = -1;

  lines.forEach((line, index) => {
    const numbers = line.cells.filter((cell) => isNumericText(cell.text)).length;
    if (numbers < TABLE_ROW_MIN_NUMBERS) return;
    if (first === -1) first = index;
    last = index;
  });

  return first === -1 ? null : { first, last };
}

function buildColumns(lines: Line[]): ColumnSpan[] {
  const band = tableBand(lines);
  const inBand = (index: number): boolean =>
    band === null || (index >= band.first && index <= band.last);

  const numeric: PlacedEntry[] = [];
  const texts: PlacedEntry[] = [];

  lines.forEach((line, index) => {
    if (!inBand(index)) return;
    for (const cell of line.cells) {
      if (isNumericText(cell.text)) numeric.push({ cell, line: index });
      else texts.push({ cell, line: index });
    }
  });

  if (numeric.length < 3) {
    // Таблицу по числам не опознали — документ не табличный. Тогда сетка из
    // всех краёв, чтобы текст хотя бы не слился в одну колонку.
    return mergeAnchors(lines.flatMap((line) => line.cells.map((cell) => ({ left: cell.x, right: cell.right }))));
  }

  // Порог повторяемости подбираем от строгого к мягкому: на настоящей
  // накладной колонки видны уже с четырёх строк, а на короткой таблице из
  // двух позиций строгий порог не оставил бы ни одного столбца.
  let numericColumns: ColumnSpan[] = [];
  for (const minLines of COLUMN_MIN_LINES) {
    numericColumns = repeatedAnchors(numeric, minLines);
    if (numericColumns.length >= 2) break;
  }
  if (numericColumns.length < 2) {
    return mergeAnchors(lines.flatMap((line) => line.cells.map((cell) => ({ left: cell.x, right: cell.right }))));
  }

  // Числовые столбцы сразу обрезаются по левому краю следующего: иначе широкое
  // число («8 600,00») своим правым краем накрывает соседний столбец, и
  // разделение «чей это заголовок» считалось бы по перекрытию полос с ошибкой.
  const numbers = mergeAnchors(numericColumns);

  // Текстовый столбец отбрасывается, только если он заголовок числового —
  // то есть начинается там же, где начинаются числа: «Кол-во» над колонкой
  // количеств, «Qty» над пятёрками, «Code» над кодами. Такой заголовок должен
  // склеиться со своими числами, а не стать отдельной колонкой. «Наименование»
  // и «Ед.» начинаются в своих точках, чисел там нет, и их края остаются —
  // иначе их текст уезжал бы в соседние числа.
  const textColumns = repeatedAnchors(texts, TEXT_COLUMN_MIN_LINES).filter(
    (anchor) => !numbers.some((column) => isSameStart(anchor, column)),
  );

  return mergeAnchors([...numbers, ...textColumns]);
}

/** Насколько две горизонтальные полосы перекрываются (0 — не перекрываются). */
function overlap(a: ColumnSpan, b: ColumnSpan): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
}

/**
 * Столбец для ячейки: тот, с которым она сильнее перекрывается по горизонтали.
 * Если перекрытия нет (ячейка висит между столбцами) — ближайший левый край,
 * потому что столбец задаёт именно левый край, а не центр.
 */
function columnIndexFor(cell: PlacedCell, columns: ColumnSpan[]): number {
  const span = { left: cell.x, right: cell.right };
  let best = 0;
  let bestScore = -1;

  for (let index = 0; index < columns.length; index += 1) {
    const covered = overlap(span, columns[index]);
    if (covered > bestScore) {
      bestScore = covered;
      best = index;
    }
  }
  if (bestScore > 0) return best;

  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < columns.length; index += 1) {
    const distance = Math.abs(columns[index].left - cell.x);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }
  return nearest;
}

/**
 * Колонки, в которых лежат «весовые» значения — суммы и количества.
 *
 * Нужны, чтобы отличить перенос строки внутри наименования от настоящей
 * следующей позиции: в каждой позиции цена и сумма заполнены, а в переносе
 * названия — пусты.
 *
 * Опираться на «первую числовую колонку» нельзя: это номер строки («№»),
 * он бывает заполнен не в каждой позиции и ломает сравнение. Поэтому берём
 * только колонки, где числа похожи на деньги или количество — есть разделитель
 * копеек, пробел-разделитель тысяч, либо значения достаточно крупные.
 */
function valueColumns(rows: unknown[][]): number[] {
  const scores = new Map<number, { filled: number; valuable: number }>();
  for (const row of rows) {
    row.forEach((cell, index) => {
      if (cell === null || cell === undefined || String(cell).trim() === "") return;
      const text = String(cell).trim();
      if (!/^[\d\s.,-]+$/.test(text)) return;
      const entry = scores.get(index) ?? { filled: 0, valuable: 0 };
      entry.filled += 1;
      // 430,00 · 8 600,00 · 1234 — деньги/количество. Голые «1», «2», «7»
      // (нумерация строк и колонок) сюда не попадают.
      const looksLikeValue = /[.,]\d{1,2}$/.test(text) || /\d[\s ]\d{3}/.test(text) || Number(text.replace(/[\s ]/g, "").replace(",", ".")) >= 100;
      if (looksLikeValue) entry.valuable += 1;
      scores.set(index, entry);
    });
  }
  return [...scores.entries()]
    .filter(([, s]) => s.filled >= 2 && s.valuable / s.filled >= 0.8)
    .map(([index]) => index);
}

/**
 * Склеивает продолжения наименований с их позициями.
 *
 * В PDF длинное название переносится на вторую визуальную строку, и в сетке
 * это выглядит как отдельная строка: текст в колонке имени, значения же
 * (цена, сумма, количество) пустые. Без склейки «Конфеты шоколадные "Кедровое
 * пралине в» и «шоколаде" 140г» попадают в журнал как два разных товара.
 *
 * Два предохранителя, без которых склейка портит документ:
 *  1. Расстояние по вертикали. Заголовок таблицы тоже «текст без чисел», и
 *     без проверки шага он прилипал к строке реквизитов сверху, теряя колонки.
 *  2. Числовая строка (нумерация «1 2 3 4 5») продолжением не бывает.
 */
function mergeWrappedRows(entries: Array<{ row: unknown[]; y: number }>): unknown[][] {
  if (entries.length < 2) return entries.map((entry) => entry.row);

  const rows = entries.map((entry) => entry.row);
  const valuable = valueColumns(rows);
  const gap = medianGap(entries);
  if (valuable.length === 0 || gap === null) return rows;

  const isEmpty = (value: unknown): boolean =>
    value === null || value === undefined || String(value).trim() === "";

  const merged: Array<{ row: unknown[]; y: number }> = [];
  for (const entry of entries) {
    const valuesFilled = valuable.filter((index) => !isEmpty(entry.row[index])).length;
    const texts = entry.row.filter((cell) => !isEmpty(cell)).map((cell) => String(cell).trim());
    const hasText = texts.some((text) => !/^[\d\s.,-]+$/.test(text));
    // Строка целиком из чисел — это нумерация, а не перенос названия.
    const allNumeric = texts.length > 0 && texts.every((text) => /^[\d\s.,-]+$/.test(text));

    const previous = merged[merged.length - 1];
    const adjacent = previous !== undefined && entry.y - previous.y <= gap * 1.6;

    if (previous && adjacent && hasText && !allNumeric && valuesFilled === 0) {
      entry.row.forEach((cell, index) => {
        if (isEmpty(cell)) return;
        previous.row[index] = isEmpty(previous.row[index])
          ? cell
          : `${String(previous.row[index])} ${String(cell)}`;
      });
      continue;
    }
    merged.push({ row: [...entry.row], y: entry.y });
  }
  return merged.map((entry) => entry.row);
}

/**
 * Типичный шаг между соседними строками текста — медиана, а не среднее:
 * несколько крупных разрывов (между шапкой и таблицей) не должны его раздуть.
 */
function medianGap(entries: Array<{ y: number }>): number | null {
  const gaps: number[] = [];
  for (let index = 1; index < entries.length; index += 1) {
    const gap = entries[index].y - entries[index - 1].y;
    if (gap > 0.5) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function pageItems(items: unknown[]): PdfTextItem[] {
  const result: PdfTextItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.str !== "string") continue;
    // Маркеры списков и артефакты разметки таблиц не несут текста.
    if (candidate.type === "beginMarkedContent" || candidate.type === "endMarkedContent") continue;
    const transform = Array.isArray(candidate.transform)
      ? candidate.transform.map(toNumber)
      : [1, 0, 0, 1, 0, 0];
    result.push({
      str: candidate.str,
      transform,
      width: toNumber(candidate.width),
      height: toNumber(candidate.height),
    });
  }
  return result;
}

/**
 * Читает текстовый PDF и возвращает по сетке на страницу.
 *
 * Пустой массив — файл без текстового слоя (скан или защищённый PDF).
 * Такой вызывающий код честно покажет человеку: «текста нет, нужен другой файл».
 */
export async function readPdf(file: File): Promise<PdfGrid[]> {
  const buffer = await file.arrayBuffer();
  return readPdfFromData(buffer);
}

export async function readPdfFromData(data: ArrayBuffer | Uint8Array): Promise<PdfGrid[]> {
  // Импорт внутри функции: pdfjs тянет worker и ~1 МБ кода, он не нужен
  // на экране журнала — грузим только когда человек выбрал PDF.
  const pdfjs = await import("pdfjs-dist");
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  // В браузере worker обязателен: без него pdfjs работает синхронно в
  // главном потоке и вешает интерфейс на больших файлах. Vite соберёт URL
  // из node_modules — из CDN ничего не тянем, приложение остаётся офлайновым.
  if (typeof window !== "undefined" && typeof Worker !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }

  const document = await pdfjs.getDocument({
    data: bytes,
    // Не подгружать внешние ресурсы: накладная не должна ходить в сеть.
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const grids: PdfGrid[] = [];
  let textLength = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = pageItems(content.items);
    textLength += items.reduce((sum, item) => sum + item.str.trim().length, 0);

    const lines = buildLines(items, viewport.height);
    const columns = buildColumns(lines);
    const entries =
      columns.length > 1
        ? toGrid(lines, columns)
        : lines.map((line) => ({ row: line.cells.map((cell) => cell.text) as unknown[], y: line.y }));

    grids.push({
      name: `Страница ${pageNumber}`,
      rows: mergeWrappedRows(entries),
      pages: document.numPages,
      looksScanned: false,
    });
  }

  await document.destroy();

  const looksScanned = textLength < 40;
  return grids.map((grid) => ({ ...grid, looksScanned }));
}
