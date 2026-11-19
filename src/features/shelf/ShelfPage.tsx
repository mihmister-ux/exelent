import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Info, PackageSearch, CalendarClock, Printer } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrustLine } from "@/components/ui/TrustLine";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import type { ShelfItem } from "@/db/types";
import { db } from "@/db/db";
import { activeSuppliers, supplierShortFrom } from "@/domain/suppliers";
import { ALL_SUPPLIERS, EMPTY_FILTER, filterItems, supplierOptions, type ShelfFilter } from "@/domain/filter";
import { activeItems, GROUP_META, groupItems, summarize } from "@/domain/groups";
import { EXPIRY_STYLE, expiryKind, type ExpiryKind } from "@/domain/expiry";
import { formatRuLong } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EditItemDialog } from "@/features/shelf/EditItemDialog";
import { ItemCard } from "@/features/shelf/ItemCard";
import { StatsStrip } from "@/features/shelf/StatsStrip";
import { SupplierTabs, type SupplierTab } from "@/features/shelf/SupplierTabs";
import { FilterBar } from "@/features/shelf/FilterBar";
import { useShelfItems, useToday } from "@/features/shelf/useShelf";
import { WeekDigest } from "@/features/shelf/WeekDigest";
import { notifyWeekExpiry } from "@/features/shelf/reminder";
import { printExpiredList } from "@/features/print/print";

/**
 * Главный экран. Группы по опасности (ТЗ, п. 1):
 * Просрочено → Истекает ≤30 дней → 31–60 дней → Всё остальное → Без срока.
 *
 * Просроченные остаются на месте, как строки журнала в Excel: они не
 * «переезжают» сами, пока человек не нажмёт «Списать» или «Продано».
 */
export default function ShelfPage() {
  const items = useShelfItems();
  const on = useToday();
  const [filter, setFilter] = useState<ShelfFilter>(EMPTY_FILTER);
  const [statFilter, setStatFilter] = useState<ExpiryKind | null>(null);
  const [editing, setEditing] = useState<ShelfItem | null>(null);

  const all = items ?? [];
  const directory = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const active = activeItems(all);
  const filtered = filterItems(active, filter, directory);

  /**
   * Вторая ступень фильтра — нажатая плитка-итог. Итоги для плиток считаем по
   * позициям в наличии: «Просрочено 1» по всему журналу включало выбывшую
   * строку, под плиткой не было ни одной строки, и нажатие давало пустой экран.
   */
  const visible = statFilter
    ? filtered.filter((item) => expiryKind(item.expiresAt, on) === statFilter)
    : filtered;
  const groups = groupItems(visible, on);
  // Показываем только выбранную группу: остальные после фильтра пустые.
  const visibleGroups = statFilter ? groups.filter((group) => group.meta.id === statFilter) : groups;
  const summary = summarize(all, on);
  const onScreen = summarize(active, on);

  // Утренняя сводка в уведомление — один раз в день, если человек разрешил.
  // Плашка ниже показывается всегда, поэтому напоминание не обязательно.
  useEffect(() => {
    if (items === undefined) return;
    notifyWeekExpiry(items, on);
  }, [items, on]);
  const suppliers = supplierOptions(all, directory);
  const directorySuppliers = activeSuppliers(directory);

  /**
   * Вкладки: «Все» + по одной на поставщика. Счётчик — позиции в наличии,
   * красный счётчик — сколько из них просрочено (ТЗ, п. 3).
   */
  const tabs = useMemo<SupplierTab[]>(() => {
    const groups = groupItems(active, on);
    const expiredBySupplier = new Map<string, number>();

    for (const entry of groups.find((group) => group.meta.id === "expired")?.entries ?? []) {
      const key = entry.item.supplier;
      expiredBySupplier.set(key, (expiredBySupplier.get(key) ?? 0) + 1);
    }

    const counts = new Map<string, number>();
    for (const item of active) counts.set(item.supplier, (counts.get(item.supplier) ?? 0) + 1);

    return [
      { value: ALL_SUPPLIERS, label: "Все", count: active.length, expired: onScreen.expired },
      ...directorySuppliers.map((supplier) => ({
        value: supplier.name,
        label: supplierShortFrom(directory, supplier.name),
        count: counts.get(supplier.name) ?? 0,
        expired: expiredBySupplier.get(supplier.name) ?? 0,
      })),
    ];
  }, [active, directory, directorySuppliers, on, onScreen.expired, suppliers]);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`Сегодня · ${formatRuLong(on)}`}
        title="Сроки"
        action={<Badge variant="secondary">{summary.total} позиций</Badge>}
      />

      <TrustLine count={summary.total} />

      <WeekDigest items={active} on={on} />

      {items === undefined ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-28 animate-pulse rounded-lg bg-secondary/70" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Журнал пуст"
          description="Импорт из Excel выполняется при первом запуске. Если строк нет — добавьте товар вручную."
          action={
            <Link
              to="/add"
              className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Добавить товар
            </Link>
          }
        />
      ) : (
        <>
          <StatsStrip
            tiles={[
              { id: "expired", label: "Просрочено", value: onScreen.expired, tone: "expired", hint: "снять с полки" },
              { id: "soon", label: "Истекает ≤30 дней", value: onScreen.soon, tone: "soon", hint: "успеть продать" },
              { id: "warning", label: "31–60 дней", value: onScreen.warning, tone: "warning", hint: "под контролем" },
              { id: "no_date", label: "Без срока", value: onScreen.noDate, tone: "no_date", hint: "нужна дата" },
            ]}
            active={statFilter}
            onSelect={(id) => setStatFilter((current) => (current === id ? null : (id as ExpiryKind)))}
          />

          <SupplierTabs
            tabs={tabs}
            active={filter.supplier}
            onChange={(supplier) => setFilter((current) => ({ ...current, supplier }))}
          />

          <FilterBar
            filter={filter}
            onChange={setFilter}
            suppliers={suppliers}
            resultCount={visible.length}
            totalCount={active.length}
          />

          {statFilter ? (
            <p className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs">
              <span>
                Показано только «{GROUP_META[statFilter].title}» — {visible.length} поз.
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setStatFilter(null)}
              >
                Показать все
              </Button>
            </p>
          ) : null}

          {onScreen.expired > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex min-w-[15rem] flex-1 items-start gap-2 rounded-lg border border-expired/20 bg-expired/5 px-3 py-2.5 text-xs text-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-expired" />
                <span>
                  Просроченные остаются в списке, пока их не спишут или не продадут — как строка
                  журнала в Excel. «Списать» переводит позицию в «Архив / выбывшие».
                </span>
              </p>
              <Button variant="outline" size="sm" onClick={() => printExpiredList(all, on)}>
                <Printer className="size-4" />
                Печать просроченного
              </Button>
            </div>
          ) : null}

          {visible.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="Ничего не нашлось"
              description={
                statFilter
                  ? "В этой группе сейчас нет позиций."
                  : "Попробуйте изменить запрос или выбрать другого поставщика."
              }
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilter({ query: "", supplier: ALL_SUPPLIERS });
                    setStatFilter(null);
                  }}
                >
                  Сбросить фильтр
                </Button>
              }
            />
          ) : (
            <div className="space-y-5">
              {visibleGroups.map((group) => (
                <section key={group.meta.id} aria-label={group.meta.title} className="space-y-2">
                  <header className="sticky top-[3.9rem] z-20 flex items-center gap-2 rounded-xl border border-border/60 bg-background/90 px-3 py-2 backdrop-blur-xl md:top-[4.6rem]">
                    <span
                      aria-hidden
                      className={cn("size-2.5 shrink-0 rounded-full", EXPIRY_STYLE[group.meta.id].dotClass)}
                    />
                    <h2 className="text-base font-semibold tracking-tight">{group.meta.title}</h2>
                    <Badge variant="secondary">{group.entries.length}</Badge>
                    <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
                      {group.meta.hint}
                    </span>
                  </header>

                  {group.entries.length === 0 ? (
                    <p className="px-1 text-xs text-muted-foreground">нет позиций</p>
                  ) : (
                    <div className="space-y-2">
                      {group.entries.map(({ item, expiry }) => (
                        <ItemCard key={item.id} item={item} expiry={expiry} onEdit={setEditing} />
                      ))}
                    </div>
                  )}
                </section>
              ))}

              {summary.writtenOff > 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  Ещё {summary.writtenOff} позиций в архиве — проданные и списанные.{" "}
                  <Link to="/archive" className="underline">
                    Открыть архив
                  </Link>
                </p>
              ) : null}
            </div>
          )}
        </>
      )}

      <EditItemDialog item={editing} suppliers={suppliers} onClose={() => setEditing(null)} />
    </div>
  );
}
