import { useState } from "react";
import { Ellipsis, Plus } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { Dialog } from "@/components/ui/dialog";
import { TABS, useActiveTab, type Tab } from "@/components/layout/navigation";
import { moreLinks, moreTarget } from "@/components/layout/more-menu";
import { cn } from "@/lib/utils";

/**
 * Сколько вкладок док показывает сам, не считая кнопки «Ещё».
 *
 * Четыре — это предел узкого экрана: две слева от «+» и две справа. Ширина
 * дока на телефоне 360–430px, а самой кнопке нужно 44px по пальцу, так что
 * пятая кнопка уже обрезала бы подписи. Пятый раздел («Поставщики») не
 * пропадает: хвост списка уходит в шефф-меню «Ещё».
 */
const DOCK_TABS = 4;

/**
 * Нижний док для телефона: четыре раздела, акцентная «+» по центру и «Ещё».
 * Кнопка выступает над полосой — карточку ею не перекрыть.
 *
 * В «Ещё» лежат «Выгрузить в Excel» и «Резервная копия»: раньше они жили
 * только в боковой панели, а она на телефоне скрыта (md:flex) — то есть с
 * Android-телефона к ним было не добраться вообще. Теперь путь такой же, как
 * с ПК: раздел на виду, редко нужное — в шторке.
 */
export function BottomDock({ tabs = TABS }: { tabs?: readonly Tab[] }) {
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();
  const activeId = useActiveTab(tabs);
  const [moreOpen, setMoreOpen] = useState(false);

  const visible = tabs.slice(0, DOCK_TABS);
  const overflow = tabs.slice(DOCK_TABS).map((tab) => ({
    key: `tab-${tab.id}`,
    id: tab.id,
    title: tab.label,
    path: tab.path,
    icon: tab.icon,
  }));
  // Активный пункт самого меню: «Выгрузить в Excel» или «Резервная копия».
  const exportTarget = moreTarget(hash);
  // «Ещё» подсвечена, когда открыт раздел из дока не попал — или сам экспорт.
  const moreActive =
    pathname.startsWith("/export") || overflow.some((link) => activeId === link.id);

  const go = (path: string) => {
    setMoreOpen(false);
    navigate(path);
  };

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
          "flex min-h-11 min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[18px] px-1 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/60",
        )}
      >
        <Icon className={cn("size-5", isActive && "text-primary")} />
        <span className="max-w-full truncate leading-none">{short ?? label}</span>
      </button>
    );
  };

  return (
    <>
      <nav aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-40 md:hidden">
        <div className="mx-auto w-full max-w-md px-3 pb-[calc(0.6rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-0.5 rounded-xl border border-border/60 bg-background/85 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl">
            {visible.slice(0, 2).map(renderTab)}

            <button
              type="button"
              onClick={() => navigate("/add")}
              aria-label="Добавить товар"
              className="-mt-7 grid size-16 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-background/80 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-7" strokeWidth={2.5} />
            </button>

            {visible.slice(2).map(renderTab)}

            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label="Ещё"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(
                "flex min-h-11 min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[18px] px-1 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                moreActive
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              <Ellipsis className={cn("size-5", moreActive && "text-primary")} />
              <span className="leading-none">Ещё</span>
            </button>
          </div>
        </div>
      </nav>

      <Dialog
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="Ещё"
        description="Экспорт, резервная копия и разделы, которым не хватило места в доке."
      >
        <div className="grid gap-1.5">
          {moreLinks(overflow).map(({ key, id, title, path, icon: Icon }) => {
            // Подсвечиваем ровно тот пункт, чей файл сейчас перед нами.
            const isActive =
              id === exportTarget ? pathname.startsWith("/export") : activeId === id;
            return (
              <button
                key={key}
                type="button"
                onClick={() => go(path)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-lg",
                    isActive ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{title}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Dialog>
    </>
  );
}

/** Отступ под фиксированный док: ставим внизу каждой страницы. */
export function DockSpacer() {
  return <div aria-hidden className="h-[calc(6.5rem+env(safe-area-inset-bottom))] md:hidden" />;
}
