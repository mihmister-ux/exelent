import { useEffect, useState } from "react";
import { Cloud, CloudOff, HardDrive } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRu } from "@/lib/dates";

/**
 * Строка доверия на главном экране (аудит п.26): честно говорит, что журнал
 * живёт на этом устройстве, работает без сети и когда была последняя копия.
 *
 * Раньше про локальность не было ни слова: кладовщик мог решить, что данные
 * уходят «в облако», и не делать копию. Здесь все три факта в одной строке —
 * их не надо искать по разделам.
 */
export interface TrustLineProps {
  /** Сколько позиций в журнале — показываем, чтобы подтвердить «данные здесь». */
  count: number;
}

const BACKUP_KEY = "shelf:lastBackupAt";

function readBackupAt(): string | null {
  try {
    return localStorage.getItem(BACKUP_KEY);
  } catch {
    return null;
  }
}

/** ISO-таймштамп копии → «17.11.2026, 14:30» по местному времени. */
function backupLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatRu(value.slice(0, 10))}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TrustLine({ count }: TrustLineProps) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [backupAt, setBackupAt] = useState<string | null>(readBackupAt);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    const updateBackup = () => setBackupAt(readBackupAt());

    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    // Копия могла сохраниться в другой вкладке — подхватываем её метку.
    window.addEventListener("storage", updateBackup);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("storage", updateBackup);
    };
  }, []);

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs text-muted-foreground">
      {online ? (
        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
          <Cloud className="size-3.5 shrink-0" />
          онлайн
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <CloudOff className="size-3.5 shrink-0" />
          оффлайн
        </span>
      )}
      <span aria-hidden className="text-border">·</span>
      <span className="inline-flex items-center gap-1">
        <HardDrive className="size-3.5 shrink-0" />
        данные на этом устройстве · {count} поз.
      </span>
      <span aria-hidden className="hidden text-border sm:inline">·</span>
      <span className={cn(!backupAt && "text-amber-700 dark:text-amber-400")}>
        {backupAt ? `копия от ${backupLabel(backupAt)}` : "копия ещё не сохранялась"}
      </span>
    </p>
  );
}
