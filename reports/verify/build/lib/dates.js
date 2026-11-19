/**
 * Даты «только день».
 *
 * В Excel у даты нет времени, поэтому и здесь сравнения идут по календарным
 * дням: TODAY() в формуле = начало сегодняшнего дня. Если сравнивать
 * с new Date() напрямую, товар со сроком «сегодня» вечером станет просроченным
 * — в таблице этого не происходило.
 */
export function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
/** Сегодняшняя дата без времени — аналог Excel TODAY(). */
export function today(now = new Date()) {
    return startOfDay(now);
}
export function addDays(date, days) {
    const next = startOfDay(date);
    next.setDate(next.getDate() + days);
    return next;
}
/** Разбор ISO-даты (YYYY-MM-DD) в локальную дату. Кривое значение → null. */
export function parseISODate(value) {
    if (!value)
        return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    // Отсекаем 2026-02-31: Date молча переносит день в март.
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return date;
}
/** Дата → ISO строка без времени (YYYY-MM-DD) по локальному календарю. */
export function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
/** Целых дней от `from` до `to` (может быть отрицательным). */
export function daysBetween(from, to) {
    const a = startOfDay(from).getTime();
    const b = startOfDay(to).getTime();
    return Math.round((b - a) / 86_400_000);
}
/** 12.11.2026 — привычный складу формат. */
export function formatRu(value) {
    if (!value)
        return "—";
    const date = typeof value === "string" ? parseISODate(value) : startOfDay(value);
    if (!date)
        return "—";
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${d}.${m}.${date.getFullYear()}`;
}
const MONTHS_RU = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
/** 12 ноября 2026 — для заголовков. */
export function formatRuLong(date) {
    return `${date.getDate()} ${MONTHS_RU[date.getMonth()]} ${date.getFullYear()}`;
}
/** Склонение: 1 день / 2 дня / 5 дней. */
export function pluralDays(n) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20)
        return "дней";
    if (last === 1)
        return "день";
    if (last >= 2 && last <= 4)
        return "дня";
    return "дней";
}
