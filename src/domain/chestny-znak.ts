/**
 * Разбор кодов маркировки «Честный знак» (DataMatrix).
 *
 * Формат GS1 DataMatrix для товаров лёгкой промышленности и косметики:
 *   FNC1 (ASCII 29 / GS) — разделитель полей, может отсутствовать в начале
 *   01 + GTIN (14 цифр)        — идентификатор товара
 *   21 + серийный номер        — до разделителя, переменная длина
 *   91 + ключ проверки (4 симв.)  — опционально
 *   92 + криптохвост (до 44 симв.) — опционально
 *
 * Сканеры возвращают либо «сырую» строку с группами (в ней могут быть
 * символы \u001d — GS, \u00e9 — FNC1 в некоторых движках), либо строку без
 * разделителей. Поэтому разбираем так:
 *   1) нормализуем FNC1/GS к единому разделителю;
 *   2) если разделители есть — идём по группам AI;
 *   3) если нет — режем по известным префиксам (01, 21, 91, 92).
 *
 * Ничего не бросаем на вход: разбор нужен, чтобы показать человеку, что
 * удалось понять, и дать подставить поля в карточку товара.
 */

/** Распознанная часть кода маркировки. */
export interface ChestnyZnakCode {
  /** Исходная строка сканера. */
  raw: string;
  /** GTIN, 14 цифр (AI 01). */
  gtin: string | null;
  /** Серийный номер (AI 21). */
  serial: string | null;
  /** Ключ проверки (AI 91), 4 символа. */
  verifyKey: string | null;
  /** Криптографическая подпись (AI 92). */
  crypto: string | null;
  /** Похоже ли на код маркировки (есть GTIN + серийник). */
  looksLikeMarking: boolean;
}

/** Обрезает невидимые управляющие символы, которые подмешивают сканеры. */
function clean(raw: string): string {
  return raw.replace(/[\r\n\t]/g, "").trim();
}

/** FNC1 / GS / кавычки-разделители → единый '\u001d'. */
function normalizeSeparators(raw: string): string {
  return raw.replace(/[\u00e9\u00e2\u001d\u001e\u001f]+/g, "\u001d");
}

/** Идём по группам AI, где поля разделены '\u001d'. */
function parseByGroups(input: string): Partial<ChestnyZnakCode> {
  const result: Partial<ChestnyZnakCode> = {};
  // Начальный GS (после FNC1) отбрасываем.
  const groups = input.replace(/^\u001d+/, "").split("\u001d");

  for (const group of groups) {
    if (!group) continue;

    // Ключевой случай: первая группа часто содержит «01 + GTIN + 21 + серийник»
    // слитно (так отдают сканеры без GS после серийника). Поэтому идём по
    // строке как по хвосту, а не читаем только два первых символа.
    let rest = group;

    if (rest.startsWith("01") && rest.length >= 16) {
      result.gtin = rest.slice(2, 16);
      rest = rest.slice(16);
    }

    // Дальше внутри той же группы может идти серийник, ключ, подпись.
    while (rest) {
      const ai = rest.slice(0, 2);

      if (ai === "21") {
        const tail = rest.slice(2);
        const candidates = [tail.indexOf("91"), tail.indexOf("92")].filter((i) => i >= 0);
        const end = candidates.length > 0 ? Math.min(...candidates) : tail.length;
        const value = tail.slice(0, end);
        if (value) result.serial = value;
        rest = tail.slice(end);
        continue;
      }

      if (ai === "91") {
        const value = rest.slice(2, 6);
        if (value) result.verifyKey = value;
        rest = rest.slice(6);
        continue;
      }

      if (ai === "92") {
        const value = rest.slice(2);
        if (value) result.crypto = value;
        rest = "";
        continue;
      }

      // Неизвестный AI — дальше не разобрать, выходим из группы.
      break;
    }
  }

  return result;
}

/**
 * Разбор строки без разделителей: режем по префиксам в известном порядке.
 * Хвост 92 — последний и «жадный», поэтому до него всё идёт по своим AI.
 */
function parseByPrefixes(input: string): Partial<ChestnyZnakCode> {
  const result: Partial<ChestnyZnakCode> = {};

  const start = input.indexOf("01");
  if (start === -1) return result;

  const gtin = input.slice(start + 2, start + 16);
  if (/^\d{14}$/.test(gtin)) result.gtin = gtin;

  let rest = input.slice(start + 16);

  // Серийник: от «21» до ближайшего «91»/«92» либо до конца.
  const serialStart = rest.indexOf("21");
  if (serialStart === 0) {
    const tail = rest.slice(2);
    const candidates = [tail.indexOf("91"), tail.indexOf("92")].filter((i) => i >= 0);
    const end = candidates.length > 0 ? Math.min(...candidates) : tail.length;
    const serial = tail.slice(0, end);
    if (serial) result.serial = serial;
    rest = tail.slice(end);
  }

  const vk = rest.indexOf("91");
  if (vk === 0) {
    result.verifyKey = rest.slice(2, 6);
    rest = rest.slice(6);
  }

  const cr = rest.indexOf("92");
  if (cr === 0 && rest.length > 2) {
    result.crypto = rest.slice(2);
  }

  return result;
}

/**
 * Разбирает код маркировки. Возвращает всё, что удалось понять;
 * поля, которых нет, остаются null.
 */
export function parseChestnyZnak(rawInput: string): ChestnyZnakCode {
  const raw = clean(rawInput ?? "");
  const empty: ChestnyZnakCode = {
    raw,
    gtin: null,
    serial: null,
    verifyKey: null,
    crypto: null,
    looksLikeMarking: false,
  };

  if (!raw) return empty;

  const normalized = normalizeSeparators(raw);
  const hasSeparators = normalized.includes("\u001d");

  const parsed = hasSeparators ? parseByGroups(normalized) : parseByPrefixes(normalized);

  const gtin = parsed.gtin ?? null;
  const serial = parsed.serial ?? null;

  return {
    raw,
    gtin,
    serial,
    verifyKey: parsed.verifyKey ?? null,
    crypto: parsed.crypto ?? null,
    looksLikeMarking: Boolean(gtin && serial),
  };
}

/**
 * Строковое представление для хранения в карточке товара.
 * Храним сам код целиком — он уникален и нужен для сверки с системой ЧЗ;
 * поля разбора выводятся отдельно, чтобы человек видел, что понято.
 */
export function formatChestnyZnak(code: ChestnyZnakCode): string {
  if (!code.looksLikeMarking) return code.raw;
  return code.raw;
}

/** Короткая подпись для UI: «GTIN · серийник». */
export function describeChestnyZnak(code: ChestnyZnakCode): string {
  if (!code.gtin && !code.serial) return "Код не распознан";
  const parts: string[] = [];
  if (code.gtin) parts.push(`GTIN ${code.gtin}`);
  if (code.serial) parts.push(`сер. ${code.serial}`);
  return parts.join(" · ");
}
