import type { ShelfItem } from "@/db/types";
import { expiringWithin } from "@/domain/groups";
import { formatRu } from "@/lib/dates";

/**
 * Напоминание о сроках (аудит п.25).
 *
 * Сейчас надо самому открыть приложение и посмотреть — для склада санатория
 * ключевой вопрос «что истекает на этой неделе». Здесь утренняя сводка
 * превращается в локальное уведомление: раз в день, при открытии, если
 * человек разрешил уведомления.
 *
 * Сознательно без service worker: push в фоне требует сервера и разрешений,
 * которых у офлайн-приложения нет. Уведомление показывается, когда приложение
 * открыли, — и не повторяется в тот же день.
 */

const ENABLED_KEY = "shelf:reminderEnabled";
const SHOWN_KEY = "shelf:reminderShownOn";
/** Сколько дней вперёд считаем «на этой неделе». */
export const REMINDER_DAYS = 7;

export function remindersSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function remindersEnabled(): boolean {
  if (!remindersSupported()) return false;
  if (Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Просит разрешение. Возвращает true, если напоминания включены. */
export async function enableReminders(): Promise<boolean> {
  if (!remindersSupported()) return false;

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  const granted = permission === "granted";
  try {
    localStorage.setItem(ENABLED_KEY, granted ? "1" : "0");
  } catch {
    // Приватный режим: разрешение есть, но флаг не сохранить — не критично.
  }
  return granted;
}

export function disableReminders(): void {
  try {
    localStorage.setItem(ENABLED_KEY, "0");
  } catch {
    // см. выше
  }
}

/**
 * Показывает утреннюю сводку один раз в день. Возвращает текст уведомления,
 * если оно было показано, иначе null (нечего сообщать / уже показывали).
 */
export function notifyWeekExpiry(items: ShelfItem[], on: Date = new Date()): string | null {
  if (!remindersEnabled()) return null;

  const today = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, "0")}-${String(
    on.getDate(),
  ).padStart(2, "0")}`;

  try {
    if (localStorage.getItem(SHOWN_KEY) === today) return null;
  } catch {
    // Без хранилища рискуем показать повторно — это лучше, чем не показать.
  }

  const upcoming = expiringWithin(items, on, REMINDER_DAYS);
  if (upcoming.length === 0) return null;

  const first = upcoming[0];
  const more = upcoming.length > 1 ? ` и ещё ${upcoming.length - 1}` : "";
  const body = `${first.name}${more} · до ${formatRu(first.expiresAt)}`;

  try {
    new Notification(`Истекает на этой неделе: ${upcoming.length}`, {
      body,
      tag: "shelf-week-expiry",
    });
  } catch {
    // Некоторые браузеры требуют service worker для showNotification —
    // тогда хотя бы плашка на экране остаётся.
    return null;
  }

  try {
    localStorage.setItem(SHOWN_KEY, today);
  } catch {
    // см. выше
  }
  return body;
}
