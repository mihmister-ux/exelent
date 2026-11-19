import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/db/db";
import type { ShelfItem } from "@/db/types";
import { startOfDay } from "@/lib/dates";

/** Живой список позиций: изменение в базе сразу перерисовывает экран. */
export function useShelfItems(): ShelfItem[] | undefined {
  return useLiveQuery(() => db.items.toArray(), []);
}

/**
 * «Сегодня» — общий на всё приложение день, а не снимок момента открытия.
 *
 * Раньше значение считалось один раз на монтирование (`useMemo(..., [])`).
 * Телефон держит приложение в фоне неделями, поэтому утром экран показывал
 * вчерашние группы: просроченное не переезжало в «Просрочено», а «осталось
 * 0 дней» относилось ко вчера. Здесь день пересчитывается, когда вкладка
 * снова становится видимой, и на границе суток.
 *
 * Значение одно на всё приложение и меняется только при смене календарного
 * дня — сортировка не «дёргается» при каждом возврате к экрану.
 */
let currentDay = startOfDay(new Date());
const dayListeners = new Set<() => void>();
let dayTimer: number | undefined;

function refreshDay() {
  const next = startOfDay(new Date());
  if (next.getTime() === currentDay.getTime()) return;
  currentDay = next;
  for (const listener of dayListeners) listener();
}

/** Подписка на смену дня живёт, только пока хоть один экран её слушает. */
function watchDay() {
  document.addEventListener("visibilitychange", refreshDay);
  window.addEventListener("focus", refreshDay);
  // Страховка на случай, когда приложение открыто на экране и пережидает полночь.
  dayTimer = window.setInterval(refreshDay, 60_000);
}

function unwatchDay() {
  document.removeEventListener("visibilitychange", refreshDay);
  window.removeEventListener("focus", refreshDay);
  if (dayTimer !== undefined) {
    window.clearInterval(dayTimer);
    dayTimer = undefined;
  }
}

export function useToday(): Date {
  const [day, setDay] = useState(currentDay);

  useEffect(() => {
    if (dayListeners.size === 0) watchDay();

    const listener = () => setDay(currentDay);
    dayListeners.add(listener);
    // Между рендером и этой подпиской день мог уже смениться.
    setDay(currentDay);

    return () => {
      dayListeners.delete(listener);
      if (dayListeners.size === 0) unwatchDay();
    };
  }, []);

  return day;
}
