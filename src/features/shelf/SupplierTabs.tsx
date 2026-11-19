import { cn } from "@/lib/utils";
import { supplierShort, supplierTone } from "@/domain/suppliers";
import { ALL_SUPPLIERS } from "@/domain/filter";

export interface SupplierTab {
  /** Значение фильтра: название поставщика или ALL_SUPPLIERS для «Все». */
  value: string;
  label: string;
  /** Сколько позиций в наличии по этому поставщику. */
  count: number;
  /** Сколько из них просрочено — на вкладке показываем красный счётчик. */
  expired: number;
}

/**
 * Вкладки поставщиков над списком. Активная выделяется заливкой;
 * если у поставщика есть просроченное, на вкладке горит красный счётчик.
 */
export function SupplierTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: SupplierTab[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Поставщики"
      className="-mx-4 flex snap-x gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
    >
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        const isAll = tab.value === ALL_SUPPLIERS;
        const tone = isAll ? null : supplierTone(tab.value);

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              "flex h-10 shrink-0 snap-start items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive
                ? "border-transparent text-white"
                : "border-border bg-card text-foreground hover:bg-secondary",
            )}
            style={isActive ? { backgroundColor: tone?.bg ?? "#0f172a" } : undefined}
          >
            {tone && !isActive ? (
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{ backgroundColor: tone.bg }}
              />
            ) : null}

            <span>{isAll ? "Все" : supplierShort(tab.value)}</span>

            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
                isActive ? "bg-white/25 text-white" : "bg-secondary text-muted-foreground",
              )}
            >
              {tab.count}
            </span>

            {tab.expired > 0 ? (
              <span
                className="flex items-center gap-1 rounded bg-expired px-1.5 py-0.5 font-mono text-[11px] font-bold text-white tabular-nums"
                title={`Просрочено: ${tab.expired}`}
              >
                <span aria-hidden className="size-1.5 rounded-full bg-white" />
                {tab.expired}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
