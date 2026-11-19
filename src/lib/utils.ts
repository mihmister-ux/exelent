import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Причина отказа одной строкой — для уведомления.
 *
 * `String(error)` на объекте даёт «[object Object]», и человек не понимает,
 * что случилось. У Error берём message, у остального — строковое описание.
 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/**
 * Русские формы счётного слова: без них в интерфейсе выходит «пропущено 1 строк».
 *   plural(1, "запись", "записи", "записей")    → "запись"
 *   plural(3, …)                                → "записи"
 *   plural(11, …)                               → "записей"
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const tail100 = Math.abs(n) % 100;
  if (tail100 >= 11 && tail100 <= 14) return many;
  switch (Math.abs(n) % 10) {
    case 1:
      return one;
    case 2:
    case 3:
    case 4:
      return few;
    default:
      return many;
  }
}
