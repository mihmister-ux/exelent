import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { TABS, useActiveTab, type Tab } from "@/components/layout/navigation";
import { cn } from "@/lib/utils";

/**
 * Нижний док для телефона: четыре раздела и акцентная «+» по центру.
 * Кнопка выступает над полосой — карточку ею не перекрыть.
 */
export function BottomDock({ tabs = TABS }: { tabs?: readonly Tab[] }) {
  const navigate = useNavigate();
  const activeId = useActiveTab(tabs);

  const renderTab = ({ id, label, short, icon: Icon, path }: Tab) => {
    const isActive = id === activeId;
    return (
      <button
        key={id}
        type="button"
        onClick={() => navigate(path)}
        aria-current={isActive ? "page" : undefined}
        aria-label={label}
        className={cn(
          "flex min-h-11 flex-1 flex-col items-center gap-0.5 rounded-[18px] px-1 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/60",
        )}
      >
        <Icon className={cn("size-5", isActive && "text-primary")} />
        <span className="leading-none">{short ?? label}</span>
      </button>
    );
  };

  return (
    <nav aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-40 md:hidden">
      <div className="mx-auto w-full max-w-md px-3 pb-[calc(0.6rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-0.5 rounded-xl border border-border/60 bg-background/85 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl">
          {tabs.slice(0, 2).map(renderTab)}

          <button
            type="button"
            onClick={() => navigate("/add")}
            aria-label="Добавить товар"
            className="-mt-7 grid size-16 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-background/80 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-7" strokeWidth={2.5} />
          </button>

          {tabs.slice(2).map(renderTab)}
        </div>
      </div>
    </nav>
  );
}

/** Отступ под фиксированный док: ставим внизу каждой страницы. */
export function DockSpacer() {
  return <div aria-hidden className="h-[calc(6.5rem+env(safe-area-inset-bottom))] md:hidden" />;
}
