import { useState } from "react";
import { Bell, BellOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ShelfItem } from "@/db/types";
import { expiringWithin } from "@/domain/groups";
import { formatRu } from "@/lib/dates";
import {
  disableReminders,
  enableReminders,
  remindersEnabled,
  remindersSupported,
  REMINDER_DAYS,
} from "@/features/shelf/reminder";

/**
 * Утренняя сводка «что истекает на этой неделе» (аудит п.25).
 *
 * Показывает конкретные позиции и ближайшую дату, а не безликое число:
 * кладовщику важнее увидеть «Чай зелёный — 19 ноября», чем «2 позиции».
 * Кнопка включает локальное уведомление — без сервера и без отправки данных.
 */
export interface WeekDigestProps {
  items: ShelfItem[];
  on: Date;
}

export function WeekDigest({ items, on }: WeekDigestProps) {
  const [enabled, setEnabled] = useState(remindersEnabled);
  const upcoming = expiringWithin(items, on, REMINDER_DAYS);

  if (upcoming.length === 0) return null;

  const first = upcoming[0];
  const names = upcoming.slice(0, 3).map((item) => item.name).join(", ");
  const more = upcoming.length > 3 ? ` и ещё ${upcoming.length - 3}` : "";

  const handleToggle = async () => {
    if (enabled) {
      disableReminders();
      setEnabled(false);
    } else {
      const ok = await enableReminders();
      setEnabled(ok);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-700/25 bg-amber-700/5 px-3 py-2.5 text-xs">
      <Bell className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
      <span className="min-w-[14rem] flex-1">
        <strong>На этой неделе истекает {upcoming.length}:</strong> {names}
        {more} · ближайшая {formatRu(first.expiresAt)}
      </span>
      {remindersSupported() ? (
        <Button variant="ghost" size="sm" className="h-9" onClick={handleToggle}>
          {enabled ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
          {enabled ? "Выключить" : "Напоминать"}
        </Button>
      ) : null}
    </div>
  );
}
