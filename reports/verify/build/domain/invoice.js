import { toISODate } from "../lib/dates.js";
const COLUMN_ALIASES = [
    ["number", ["№", "н/п", "п/п", "пн", "п/н", "номер", "no", "n"]],
    [
        "name",
        [
            "наименование",
            "наименование товара",
            "товар",
            "товар (услуга)",
            "наименование позиции",
            "описание",
            // Английские шапки: счета зарубежных поставщиков приходят с «Name»,
            // «Description», «Item» — без них такой документ не разбирался вовсе.
            "name",
            "description",
            "item",
            "item name",
            "product",
            "goods",
        ],
    ],
    ["code", ["код", "артикул", "код товара", "номенклатура", "code", "item code", "sku"]],
    ["quantity", ["кол-во", "количество", "кол", "qty", "шт", "quantity"]],
    ["unit", ["ед", "ед.", "ед изм", "единица", "единица измерения", "unit", "uom"]],
    ["price", ["цена", "цена за ед", "цена единицы", "price", "unit price"]],
    ["amount", ["сумма", "сумма всего", "итого", "amount", "total", "sum"]],
    ["expiry", ["годен до", "срок годности", "срок", "дата окончания", "expiry", "best before", "good until"]],
    ["supplier", ["поставщик", "поставщик товара", "фирма", "производитель", "supplier", "vendor"]],
];
/** Слова-маркеры реквизитов: если они в заголовке — это не таблица товаров. */
const REQUISITE_WORDS = [
    "инн", "кпп", "адрес", "телефон", "банк", "р/с", "рс", "бик", "окпо",
    "оквед", "плательщик", "получатель", "покупатель", "организация", "директор",
    "главный бухгалтер", "подпись", "договор", "накладная №",
];
/** Строки-итоги и подписи, которые не должны попасть в журнал. */
const FOOTER_WORDS = [
    "итого", "всего", "итог", "total", "сумма прописью", "прописью",
    "сдал", "принял", "подпись", "главный бухгалтер", "директор", "печать",
    "отпустил", "получил", "разрешил", "заведующий",
];
/** Приводит ячейку заголовка к нижнему регистру «№», «ед.» и т.п. */
function normHeader(value) {
    if (value === null || value === undefined)
        return "";
    return String(value)
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[\r\n\t ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function matchColumn(header) {
    if (!header)
        return null;
    // Точное совпадение приоритетнее подстроки: «сумма» не должно стать «итого».
    for (const [column, aliases] of COLUMN_ALIASES) {
        if (aliases.some((alias) => header === alias))
            return column;
    }
    for (const [column, aliases] of COLUMN_ALIASES) {
        if (aliases.some((alias) => alias.length > 1 && header.includes(alias)))
            return column;
    }
    return null;
}
function looksLikeRequisites(row) {
    const text = row.map(normHeader).join(" ");
    const hasRequisite = REQUISITE_WORDS.some((word) => text.includes(word));
    const productColumns = row.filter((value) => matchColumn(normHeader(value))).length;
    return hasRequisite && productColumns < 2;
}
/**
 * Ищет строку заголовка таблицы товаров. Требование: колонка «наименование»
 * и ещё хотя бы одна товарная колонка из набора (код/кол-во/цена/сумма/ед/годен до).
 * Одинокое «наименование организации» не проходит.
 */
function findHeader(sheet) {
    let best = null;
    sheet.rows.forEach((row, rowIndex) => {
        if (looksLikeRequisites(row))
            return;
        const columns = {};
        row.forEach((value, columnIndex) => {
            const column = matchColumn(normHeader(value));
            if (column && columns[column] === undefined)
                columns[column] = columnIndex;
        });
        if (columns.name === undefined)
            return;
        const productColumns = ["code", "quantity", "unit", "price", "amount", "expiry"]
            .filter((column) => columns[column] !== undefined).length;
        if (productColumns === 0)
            return;
        const score = productColumns + (columns.number !== undefined ? 0.5 : 0);
        if (!best || score > best.score)
            best = { rowIndex, columns, score };
    });
    return best;
}
/** Число из ячейки: «1 200,50» → 1200.5, «12,3 кг» → 12.3. */
export function parseNumber(value) {
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined)
        return null;
    const text = String(value)
        .replace(/\s| /g, "")
        .replace(/[^\d,.\-]/g, "");
    if (!text || text === "-" || text === "." || !/\d/.test(text))
        return null;
    const number = Number(normalizeSeparators(text));
    return Number.isFinite(number) ? number : null;
}
/**
 * «1.200,50» → «1200.50». Десятичный разделитель — тот, что правее:
 * в накладных тысячи отделяют точкой, а копейки запятой. Если разделитель
 * один, точка остаётся десятичной.
 */
function normalizeSeparators(text) {
    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    if (comma === -1)
        return text;
    if (dot === -1)
        return text.replace(/,/g, ".");
    return comma > dot ? text.replace(/\./g, "").replace(/,/g, ".") : text.replace(/,/g, "");
}
/**
 * Месяцы в родительном падеже — так их печатают в счетах на оплату
 * («13 июля 2026 г.»). Индекс массива = номер месяца с нуля.
 */
const RU_MONTHS = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
/**
 * Дата из ячейки: Date из Excel, число-сериал, строка «01.02.2027»,
 * «01.02.27», «2027-02-01» или «13 июля 2026 г.». Битая строка
 * («18.09..29») возвращается как raw.
 */
export function parseInvoiceDate(value) {
    if (value === null || value === undefined || value === "")
        return { iso: null, raw: null };
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return { iso: toISODate(value), raw: null };
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
        // Сериал Excel: эпоха 1899-12-30 (учтён високосный 1900).
        const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
        return { iso: date.toISOString().slice(0, 10), raw: null };
    }
    const text = String(value).trim();
    // «13 июля 2026 г.» — так печатает дату 1С в счёте на оплату. Без этой ветки
    // дата документа оставалась пустой, и журнал не знал, когда пришёл товар.
    const written = /(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i.exec(text.replace(/ё/gi, "е"));
    if (written) {
        const month = RU_MONTHS.indexOf(written[2].toLowerCase());
        if (month !== -1) {
            const date = new Date(Number(written[3]), month, Number(written[1]));
            if (date.getDate() === Number(written[1]))
                return { iso: toISODate(date), raw: null };
        }
    }
    // Порядок components разный: ISO = год-месяц-день, русский = день.месяц.год,
    // американский mm/dd/yy из выгрузок Excel. Смешивать их одним match
    // нельзя — иначе 2026-09-18 читается как 18-09-2026.
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(text);
    const ru = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4}|\d{2})(?!\d)/.exec(text);
    // «11/17/27» — это November 17, 2027 (месяц/день/год), а не 17 ноября
    // в русской записи. Отличаем по разделителю «/» и двузначному году:
    // русский «17.11.27» использует точки.
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2})(?!\d)/.exec(text);
    const match = iso ?? ru ?? us;
    if (!match)
        return { iso: null, raw: text };
    const yearRaw = Number(iso ? match[1] : match[3]);
    const month = Number(us ? match[1] : match[2]);
    const day = Number(us ? match[2] : iso ? match[3] : match[1]);
    const year = yearRaw < 100 ? (yearRaw >= 70 ? 1900 + yearRaw : 2000 + yearRaw) : yearRaw;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return { iso: null, raw: text };
    }
    return { iso: toISODate(date), raw: null };
}
function cellText(row, index) {
    if (index === undefined)
        return "";
    const value = row[index];
    if (value === null || value === undefined)
        return "";
    if (value instanceof Date && !Number.isNaN(value.getTime()))
        return toISODate(value);
    return String(value).trim();
}
function isFooter(row) {
    const text = row.map(normHeader).filter(Boolean).join(" ");
    return FOOTER_WORDS.some((word) => text.includes(word));
}
function isBlank(row) {
    return row.every((value) => value === null || value === undefined || String(value).trim() === "");
}
function looksLikeRequisitionRow(row) {
    const text = row.map(normHeader).filter(Boolean).join(" ");
    return REQUISITE_WORDS.some((word) => text.includes(word));
}
/**
 * Из «Накладная № 451 от 12.11.2026» или «Invoice No 2804 dated 26.10.2026»
 * достаём дату поступления.
 *
 * Слова-маркеры нужны, чтобы не схватить дату из реквизитов («Договор … от
 * 09.11.2023») — она тоже стоит в шапке и выглядит как настоящая. Английские
 * «date/dated/invoice» в списке потому, что счёт 2804 приходит без них не
 * разбирался вовсе: дата документа оставалась пустой.
 */
/**
 * Из «Накладная № 451 от 12.11.2026» или «Счет на оплату № 640 от 13 июля 2026 г.»
 * достаём дату поступления.
 *
 * Два прохода, и это важно. Сначала ищем строку, где дата стоит рядом с
 * названием документа («счёт», «накладная», «invoice»). Только потом — любую
 * дату в шапке. Один проход брал первую снизу строку и на реальном счёте
 * цеплял «Основание: Договор … от 09.11.2023г.» — дату договора вместо даты
 * поставки. Английские «dated/invoice» в списке потому, что без них счёт 2804
 * оставался вовсе без даты.
 */
export function findDocumentDate(sheet, headerIndex) {
    const DOCUMENT = /накладн|счет|счёт|invoice|дата|dated/i;
    const ANY_DATE = /от\s*\d/i;
    const textAt = (index) => sheet.rows[index]
        .filter((value) => value !== null && value !== undefined)
        .map((value) => (value instanceof Date ? toISODate(value) : String(value)))
        .join(" ");
    const dateIn = (text) => {
        // День и месяц бывают однозначными («от 3.2.2026»), год — двузначным
        // («26.10.26»), а 1С печатает «13 июля 2026 г.» словами.
        const found = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)?.[0] ??
            /(\d{1,2})[.](\d{1,2})[.](\d{4})/.exec(text)?.[0] ??
            /(\d{1,2})\s+[а-яё]+\s+(\d{4})/i.exec(text)?.[0] ??
            /(\d{1,2})[.](\d{1,2})[.](\d{2})(?!\d)/.exec(text)?.[0] ??
            "";
        const parsed = parseInvoiceDate(found);
        return parsed.iso;
    };
    const from = Math.max(0, headerIndex - 12);
    const candidates = [];
    for (let index = headerIndex - 1; index >= from; index -= 1)
        candidates.push(index);
    for (const wanted of [DOCUMENT, ANY_DATE]) {
        for (const index of candidates) {
            const text = textAt(index);
            if (!wanted.test(text))
                continue;
            const iso = dateIn(text);
            if (iso)
                return iso;
        }
    }
    return null;
}
/**
 * Поставщик из шапки: «Поставщик: ООО Лотос» / «Supplier: Farm Zavod Galen LLC».
 *
 * В PDF ячейка поставщика часто содержит всю реквизитную строку целиком:
 * «Общество с ограниченной ответственностью "РИФ И КО", ИНН 0400001746,
 * КПП 040001001, 649002, Алтай респ, …». В журнал нужно имя организации, а не
 * адрес с ИНН, поэтому строка обрезается по первому реквизитному маркеру.
 */
function findSupplierInHeader(sheet, headerIndex) {
    for (let index = 0; index < headerIndex; index += 1) {
        const row = sheet.rows[index];
        for (let column = 0; column < row.length; column += 1) {
            const text = normHeader(row[column]);
            if (!/^(поставщик|supplier|vendor)/.test(text))
                continue;
            const same = cellText(row, column + 1);
            if (same && !/^(поставщик|supplier|vendor)/.test(normHeader(same))) {
                return trimSupplier(same);
            }
            const whole = row.map((value) => String(value ?? "").trim()).join(" ");
            const match = /(?:поставщик|supplier|vendor)\s*:?\s*(.+)$/i.exec(whole);
            if (match?.[1])
                return trimSupplier(match[1]);
        }
    }
    return "";
}
/**
 * Отрезает от строки поставщика реквизиты: ИНН, КПП, адрес, телефон.
 *
 * Границы слова `\b` здесь неприменимы: в JavaScript она считается по `\w`,
 * то есть по латинице и цифрам, а кириллица для неё — не-слово. Из-за этого
 * «ИНН» после пробела не находился, и в журнал уезжала вся реквизитная строка.
 */
function trimSupplier(value) {
    // INN/KPP — те же ИНН/КПП латиницей: так их печатает счёт зарубежного
    // поставщика, и без них адрес с реквизитами оставался в имени поставщика.
    const markers = /,?\s*(?:ИНН|КПП|ОГРН|ОКПО|INN|KPP|OGRN|адрес|address|тел\.?|phone|р\/с|бик)\s*[:№]/i;
    const numbers = /,?\s*(?:ИНН|КПП|ОГРН|ОКПО|INN|KPP|OGRN)\s+\d/i;
    const cut = value.search(markers);
    const rest = value.search(numbers);
    const at = cut === -1 ? rest : cut;
    const name = (at === -1 ? value : value.slice(0, at)).replace(/[,\s]+$/, "").trim();
    return name || value.trim();
}
/**
 * Имя листа — последний источник поставщика; служебные имена игнорируем.
 *
 * «Страница 1» — имя, которое pdf.ts само даёт прочитанным страницам. Раньше
 * оно проходило проверку и становилось поставщиком, попадая в журнал вместо
 * реального «ООО РИФ И КО» из шапки.
 */
function supplierFromSheet(name) {
    const clean = name.trim();
    if (!clean)
        return "";
    if (/^(лист\s*\d*|sheet\d*|товары|накладная|table\d*|страница\s*\d*|page\s*\d*)$/i.test(clean))
        return "";
    return clean;
}
/**
 * Ячейка содержит только число — «2», «2.», «2 014», «43 720,00» — это номер
 * строки или итог, а не название товара.
 *
 * Пробелы внутри разрешены намеренно: в счётах суммы печатают с разделителем
 * тысяч («43 720»), и без этого строка итогов без подписи («159» и «43 720»
 * в колонках количества и суммы) попадала в журнал товаром с наименованием
 * «43 720». Буквы по-прежнему означают название: «Крем 5 мл» числом не станет.
 */
function isNumericCell(value) {
    if (typeof value === "number")
        return Number.isFinite(value);
    if (value === null || value === undefined)
        return false;
    const text = String(value).trim();
    if (!text)
        return false;
    if (!/^[\d\s.,-]+$/.test(text))
        return false;
    return parseNumber(text) !== null;
}
/**
 * В счётах-фактурах строка сразу под заголовком — это нумерация колонок
 * «1 2 3 4 5», а не товары. Отличаем её по набору коротких чисел и по тому,
 * что ни в одной товарной колонке нет осмысленного значения.
 *
 * Начинаться нумерация обязана с единицы: без этого под правило попадала
 * любая строка из коротких чисел, и позиция с артикулом вместо названия
 * («12345», количество 3) молча выбрасывалась из журнала.
 */
function isColumnNumberingRow(row, columns) {
    const cells = Object.values(columns)
        .filter((index) => index !== undefined)
        .map((index) => cellText(row, index))
        .filter(Boolean);
    if (cells.length < 2)
        return false;
    if (cells[0] !== "1")
        return false;
    const numeric = cells.filter(isNumericCell).length;
    const allShort = cells.every((cell) => cell.length <= 5);
    return numeric >= Math.max(2, Math.ceil(cells.length * 0.6)) && allShort;
}
/**
 * Берём наименование из соседней колонки, если в «Наименовании» оказалось
 * число/номер строки из-за сдвига колонок в выгрузке.
 */
function resolveName(row, columns) {
    const direct = cellText(row, columns.name);
    if (direct && !isNumericCell(direct))
        return direct;
    // «Наименование» не дало названия: либо пусто, либо в нём голое число —
    // значит колонки сдвинуты и название уехало в соседнюю ячейку.
    const numericName = direct !== "" && isNumericCell(direct);
    // Кандидаты: всё справа и слева от колонки name. При сдвиге колонок
    // настоящее название может оказаться даже там, где обычно количество,
    // поэтому «служебные» колонки не исключаем — их защищают проверки ниже:
    // числа отсекает isNumericCell, коды/артикулы — regex `[A-Za-z0-9/_\-]`.
    const order = [...row.keys()].sort((a, b) => Math.abs(a - (columns.name ?? 0)) - Math.abs(b - (columns.name ?? 0)));
    for (const index of order) {
        if (index === columns.number)
            continue;
        const text = cellText(row, index);
        if (!text || isNumericCell(text))
            continue;
        // Код товара/артикул — не название: это цифры или артикул латиницей.
        if (/^[A-Za-z0-9\-_/]+$/.test(text))
            continue;
        return text;
    }
    // Название так и не нашли. Голое число вернуть как имя нельзя — это «2»
    // (нумерация) или «43 720» (итог). Исключение — артикул: целое без
    // разделителей тысяч от четырёх знаков («12345», «0870»). Такое число
    // действительно бывает наименованием позиции в выгрузке.
    if (!numericName)
        return direct;
    return /^\d{4,}$/.test(direct) ? direct : "";
}
/** Сколько колонок таблицы реально заполнено в строке. */
function filledColumns(row, columns) {
    return Object.values(columns).filter((index) => index !== undefined && cellText(row, index) !== "").length;
}
/** Сколько пустых строк подряд считаем «пробелом» внутри таблицы, а не концом. */
const MAX_BLANK_GAP = 3;
/**
 * Есть ли ниже ещё товар. Нужен, чтобы пустая строка в середине накладной
 * (разделитель между группами в выгрузке из 1С) не обрывала разбор —
 * иначе позиции после неё молча не попадали в журнал.
 */
function goodsAhead(sheet, from, columns) {
    const limit = Math.min(sheet.rows.length, from + MAX_BLANK_GAP);
    for (let index = from; index < limit; index += 1) {
        const row = sheet.rows[index];
        if (isBlank(row))
            continue;
        if (isFooter(row) || looksLikeRequisitionRow(row))
            return false;
        return cellText(row, columns.name) !== "" || filledColumns(row, columns) >= 2;
    }
    return false;
}
/** Разбирает один лист. Возвращает null, если таблицы товаров на нём нет. */
export function parseInvoiceSheet(sheet) {
    const header = findHeader(sheet);
    if (!header)
        return null;
    const { rowIndex: headerIndex, columns } = header;
    const headerSupplier = findSupplierInHeader(sheet, headerIndex);
    const supplier = headerSupplier || supplierFromSheet(sheet.name);
    const rows = [];
    const skipped = [];
    let sawData = false;
    for (let index = headerIndex + 1; index < sheet.rows.length; index += 1) {
        const row = sheet.rows[index];
        const sourceRow = index + 1;
        if (isBlank(row)) {
            // Пустая строка — не всегда конец таблицы: в выгрузках она разделяет
            // группы товаров. Обрываем разбор, только если ниже товара нет.
            if (sawData && !goodsAhead(sheet, index + 1, columns))
                break;
            skipped.push(sourceRow);
            continue;
        }
        if (isFooter(row) || looksLikeRequisitionRow(row)) {
            if (sawData)
                break;
            skipped.push(sourceRow);
            continue;
        }
        if (isColumnNumberingRow(row, columns)) {
            // Строка «1 2 3 4 5 6 7 8» под заголовком счёта — не товары.
            skipped.push(sourceRow);
            continue;
        }
        const name = resolveName(row, columns);
        if (!name) {
            // Без наименования позиции не существует: это либо продолжение
            // объединённой ячейки, либо служебная строка. В журнал не берём.
            skipped.push(sourceRow);
            if (sawData && !goodsAhead(sheet, index + 1, columns))
                break;
            continue;
        }
        sawData = true;
        const expiryCell = columns.expiry === undefined ? null : row[columns.expiry];
        const date = parseInvoiceDate(expiryCell);
        const number = parseNumber(cellText(row, columns.number));
        const quantity = parseNumber(cellText(row, columns.quantity));
        const price = parseNumber(cellText(row, columns.price));
        const amount = parseNumber(cellText(row, columns.amount));
        const warnings = [];
        if (columns.expiry !== undefined && expiryCell !== null && expiryCell !== undefined && expiryCell !== "") {
            if (date.iso === null && date.raw)
                warnings.push("не удалось распознать дату срока");
        }
        if (price !== null && quantity !== null && amount !== null) {
            const expected = Math.round(price * quantity * 100) / 100;
            if (Math.abs(expected - amount) > Math.max(1, expected * 0.02)) {
                warnings.push(`цена × кол-во = ${expected}, в таблице ${amount}`);
            }
        }
        rows.push({
            sourceRow,
            number: number === null ? cellText(row, columns.number) : String(number),
            name,
            code: cellText(row, columns.code),
            quantity: quantity === null ? cellText(row, columns.quantity) : String(quantity),
            unit: cellText(row, columns.unit),
            price: price === null ? cellText(row, columns.price) : String(price),
            amount: amount === null ? cellText(row, columns.amount) : String(amount),
            expiresAt: date.iso,
            rawExpires: date.raw,
            supplier: cellText(row, columns.supplier) || supplier,
            warning: warnings.length ? warnings.join("; ") : null,
        });
    }
    const confidence = Math.min(1, 0.45 + Object.keys(columns).length * 0.06 + Math.min(rows.length, 10) * 0.02);
    return { sheet: sheet.name, headerRow: headerIndex + 1, supplier, columns, rows, skipped, confidence };
}
/** Первый лист с таблицей товаров; пустой результат, если ничего не нашли. */
export function parseInvoice(sheets) {
    for (const sheet of sheets) {
        const result = parseInvoiceSheet(sheet);
        if (result && result.rows.length > 0)
            return result;
    }
    return null;
}
