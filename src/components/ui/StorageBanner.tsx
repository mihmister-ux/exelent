import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";

/**
 * Баннер вверху страницы: если `navigator.storage.persist()` вернул false,
 * данные могут быть вычищены. На рабочем столе (Chrome/Edge/Яндекс) persist
 * почти всегда дают; на телефоне Xiaomi/MIUI — почти никогда.
 *
 * Состояние persist записывается из main.tsx в window.__dsPersistGranted — так
 * баннер читает его синхронно без лишнего эффекта.
 */

/** Выставлен из main.tsx до монтирования приложения. */
declare global {
  interface Window {
    __dsPersistGranted?: boolean;
  }
}

export function StorageBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function check() {
      setShow(window.__dsPersistGranted !== true);
    }

    // Если флаг ещё не выставлен — ждём события; если выставлен — решаем сразу.
    if (window.__dsPersistGranted !== undefined) {
      check();
    }

    window.addEventListener("ds-persist-resolved", check);
    return () => window.removeEventListener("ds-persist-resolved", check);
  }, []);

  if (!show) return null;

  return (
    <div className="flex items-start gap-2 border-b border-amber-700/30 bg-amber-700/8 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
      <HardDrive className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Хранилище не защищено от очистки — данные могут пропасть при нехватке места.{" "}
        <strong>Сохраните копию в разделе «Выгрузить в Excel».</strong>
      </span>
    </div>
  );
}