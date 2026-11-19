import { FileSpreadsheet, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { TABS, useActiveTab } from "@/components/layout/navigation";
import { cn } from "@/lib/utils";

/** Боковая панель для широких экранов: те же разделы, что и в доке. */
export function SideNav() {
  const navigate = useNavigate();
  const activeId = useActiveTab();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border/60 bg-background/80 backdrop-blur-xl md:flex">
      {/*
        Верх — бренд. Плашка тёмная с белым жирным текстом, как в референсе, и
        прижата к левому краю: её левая кромка стоит на одной вертикали с
        заголовком «Разделы» (px-3 у nav + px-2 у самого заголовка = 20px),
        поэтому в разметке те же 20px, а не «на глаз».

        Форма — «стадион» (rounded-full), как на референсе: там плашка целиком
        скруглена по короткой стороне, а не просто со скруглёнными углами.

        Размер — ровно 0,7 от прежнего (18px/16px/10px → 12,6px/11,2px/7px),
        то есть на 30% меньше по высоте и по ширине. Значения даны в rem, чтобы
        плашка масштабировалась вместе с корневым кеглем.
      */}
      <div className="flex flex-col px-5 pt-5">
        <span className="inline-flex w-fit items-center rounded-full bg-primary px-[0.7rem] py-[0.4375rem] text-[0.7875rem] leading-none font-bold text-primary-foreground">
          EXELent
        </span>
        <img
          src={`${import.meta.env.BASE_URL}logo-rus.png`}
          alt="Санаторий Русь"
          className="mt-4 h-14 w-auto max-w-[160px] shrink-0 self-center rounded bg-white object-contain"
        />
      </div>

      <nav aria-label="Основная навигация" className="flex-1 space-y-1 px-3 pt-5">
        <p className="px-2 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Разделы
        </p>

        {TABS.map(({ id, label, icon: Icon, path }) => {
          const isActive = id === activeId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(path)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => navigate("/export")}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileSpreadsheet className="size-4" />
          Выгрузить в Excel
        </button>
      </nav>

      <div className="border-t border-border/60 p-3">
        <button
          type="button"
          onClick={() => navigate("/add")}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" />
          Добавить товар
        </button>
        <p className="mt-2 px-1 text-xs leading-snug text-muted-foreground">
          Название, поставщик и «годен до» — всё остальное приложение считает само.
        </p>
      </div>
    </aside>
  );
}
