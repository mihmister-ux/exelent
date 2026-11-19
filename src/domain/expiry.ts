import { addDays, daysBetween, parseISODate, pluralDays, startOfDay } from "@/lib/dates";

/**
 * Статус срока — вычисляется, не хранится.
 *
 * Формулы источника (условное форматирование A4:I1003 на каждом листе):
 *   1) AND($D4<>"", $D4<TODAY())                          → заливка #8B0000, шрифт белый
 *   2) AND($D4<>"", $D4>=TODAY(), $D4<=TODAY()+30)        → заливка #FF0000, шрифт белый
 *   3) AND($D4<>"", $D4>TODAY()+30, $D4<=TODAY()+60)      → заливка #FFEB9C, шрифт чёрный
 *
 * И формула колонки F: IF(D4="","",IF(D4<TODAY(),"Просрочен",""))
 *
 * Порядок проверок ниже повторяет эти три правила один в один, включая
 * границы: срок «сегодня» — ещё не просрочен, ровно +30 — ещё «красный»,
 * ровно +60 — ещё «жёлтый», +61 — уже без подсветки.
 */

export type ExpiryKind = "expired" | "soon" | "warning" | "ok" | "no_date";

/** Границы из Excel: TODAY()+30 и TODAY()+60. */
export const SOON_DAYS = 30;
export const WARNING_DAYS = 60;

export interface ExpiryInfo {
  kind: ExpiryKind;
  /** Осталось дней; отрицательное — просрочено. null — срок не задан. */
  days: number | null;
  /** Ровно то, что показывала колонка F источника. */
  excelFCell: string;
  /** Короткая подпись для интерфейса. */
  headline: string;
}

export function expiryKind(expiresAt?: string | null, on: Date = startOfDay(new Date())): ExpiryKind {
  const expires = parseISODate(expiresAt);
  if (!expires) return "no_date";

  const days = daysBetween(on, expires);
  if (days < 0) return "expired";
  if (days <= SOON_DAYS) return "soon";
  if (days <= WARNING_DAYS) return "warning";
  return "ok";
}

export function expiryInfo(expiresAt?: string | null, on: Date = startOfDay(new Date())): ExpiryInfo {
  const expires = parseISODate(expiresAt);
  const kind = expiryKind(expiresAt, on);
  const days = expires ? daysBetween(on, expires) : null;

  return {
    kind,
    days,
    excelFCell: kind === "expired" ? "Просрочен" : "",
    headline: headlineFor(kind, days),
  };
}

function headlineFor(kind: ExpiryKind, days: number | null): string {
  if (kind === "no_date" || days === null) return "срок не указан";
  if (kind === "expired") return `просрочен ${Math.abs(days)} ${pluralDays(days)} назад`;
  if (kind === "soon") return days === 0 ? "истекает сегодня" : `осталось ${days} ${pluralDays(days)}`;
  return `осталось ${days} ${pluralDays(days)}`;
}

/**
 * Оформление по цветам Excel, но в строгом деловом виде: белая карточка,
 * чёткая граница, цвет статуса — полосой слева, плашкой и лёгкой подложкой.
 * Полная заливка строки, как в таблице, на белом фоне выглядела бы слишком
 * тяжёлой, а смысл цветов сохранён: тот же оттенок в том же статусе.
 */
export interface ExpiryStyle {
  /** HEX заливки из условного форматирования; null — правила не срабатывало. */
  fill: string | null;
  textColor: string | null;
  title: string;
  /** Цвет полосы слева: цвет статуса либо серый, если статуса нет. */
  stripe: string;
  /** Плашка со статусом. */
  chip: string;
  /** Лёгкая подложка карточки. */
  tint: string;
  /** Цвет маркера в заголовке группы и во вкладках. */
  dotClass: string;
  /** Плашка статуса в списке «Товары». */
  chipClass: string;
}

export const EXPIRY_STYLE: Record<ExpiryKind, ExpiryStyle> = {
  expired: {
    fill: "#8b0000",
    textColor: "#ffffff",
    title: "Просрочено",
    stripe: "#8b0000",
    chip: "bg-[#8b0000] text-white",
    tint: "bg-[#8b0000]/[0.04]",
    dotClass: "bg-[#8b0000]",
    chipClass: "bg-[#8b0000] text-white",
  },
  soon: {
    fill: "#ff0000",
    textColor: "#ffffff",
    title: "Истекает ≤30 дней",
    stripe: "#ff0000",
    chip: "bg-[#ff0000] text-white",
    tint: "bg-[#ff0000]/[0.04]",
    dotClass: "bg-[#ff0000]",
    chipClass: "bg-[#ff0000] text-white",
  },
  warning: {
    fill: "#ffeb9c",
    textColor: "#1a1714",
    title: "Истекает 31–60 дней",
    stripe: "#ffeb9c",
    chip: "bg-[#ffeb9c] text-[#0f172a]",
    tint: "bg-[#ffeb9c]/40",
    dotClass: "bg-[#ffeb9c]",
    chipClass: "bg-[#ffeb9c] text-[#0f172a]",
  },
  ok: {
    fill: null,
    textColor: null,
    title: "Всё остальное",
    stripe: "#94a3b8",
    chip: "bg-muted text-muted-foreground",
    tint: "",
    dotClass: "bg-[#94a3b8]",
    chipClass: "bg-muted text-muted-foreground",
  },
  no_date: {
    fill: null,
    textColor: null,
    title: "Без срока",
    stripe: "#cbd5e1",
    chip: "bg-muted text-muted-foreground",
    tint: "",
    dotClass: "bg-[#cbd5e1]",
    chipClass: "bg-muted text-muted-foreground",
  },
};

/** Дата, до которой товар ещё годен при правиле «ровно +N дней от сегодня». */
export function windowEnd(on: Date, days: number): Date {
  return addDays(on, days);
}
