import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Уведомления без провайдера: маленький модульный стор на замыкании.
 * Нужно одно место на приложение — <Toaster /> в App.
 */

export type ToastTone = "default" | "success" | "danger";

/**
 * Кнопка внутри уведомления. Нужна для действий, которые страшно оставить
 * без отмены: «Продано» — одно касание, а промахнуться на телефоне легко.
 */
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

let items: ToastItem[] = [];
let listeners: Array<(next: ToastItem[]) => void> = [];
let nextId = 1;

function emit() {
  const snapshot = [...items];
  for (const listener of listeners) listener(snapshot);
}

/** Убрать уведомление досрочно: по таймеру или после нажатия на кнопку. */
function dismiss(id: number) {
  items = items.filter((current) => current.id !== id);
  emit();
}

export function toast(
  message: string,
  tone: ToastTone = "default",
  durationMs = 3600,
  action?: ToastAction,
) {
  const item: ToastItem = { id: nextId++, message, tone, action };
  items = [...items, item];
  emit();
  window.setTimeout(() => dismiss(item.id), durationMs);
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.push(setList);
    setList([...items]);
    return () => {
      listeners = listeners.filter((listener) => listener !== setList);
    };
  }, []);

  if (list.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {list.map((item) => (
        <div
          key={item.id}
          className={cn(
            "animate-reveal flex w-full max-w-md items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg",
            item.tone === "default" && "border-border bg-card text-foreground",
            item.tone === "success" && "border-emerald-700/20 bg-emerald-700 text-white",
            item.tone === "danger" && "border-destructive/30 bg-destructive text-destructive-foreground",
          )}
        >
          {item.tone === "success" ? <CheckCircle2 className="size-4 shrink-0" /> : null}
          {item.tone === "danger" ? <TriangleAlert className="size-4 shrink-0" /> : null}
          {item.tone === "default" ? <Info className="size-4 shrink-0 text-accent" /> : null}
          <span className="min-w-0 flex-1">{item.message}</span>

          {item.action ? (
            <button
              type="button"
              // pointer-events-auto только у кнопки: сама плашка остаётся
              // «прозрачной» для касаний и не перехватывает тапы по экрану.
              // min-h-9 — палец в перчатке иначе бьёт мимо слова «Отменить».
              className="pointer-events-auto ml-auto inline-flex min-h-9 shrink-0 items-center rounded-md border border-current px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
              onClick={() => {
                // Уведомление убираем первым: даже если действие упадёт,
                // кнопка не останется висеть на экране.
                dismiss(item.id);
                void item.action?.onClick();
              }}
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>,
    document.body,
  );
}
