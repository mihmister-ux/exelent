import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PackageSearch } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SupplierBadge } from "@/components/ui/supplier-badge";
import { db } from "@/db/db";
import type { ShelfItem, ShelfStatus } from "@/db/types";
import { STATUS_LABEL } from "@/db/types";
import { ALL_SUPPLIERS, EMPTY_FILTER, filterItems, supplierOptions, type ShelfFilter } from "@/domain/filter";
import { EXPIRY_STYLE, expiryInfo } from "@/domain/expiry";
import { receivedLabel } from "@/domain/received";
import { formatRu } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EditItemDialog } from "@/features/shelf/EditItemDialog";
import { FilterBar } from "@/features/shelf/FilterBar";
import { useShelfItems, useToday } from "@/features/shelf/useShelf";

type StatusFilter = "all" | ShelfStatus;

const STATUS_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "in_stock", label: "В наличии" },
  { id: "sold", label: "Проданы" },
  { id: "written_off", label: "Списаны" },
];

/** «Товары»: поиск по названию и фильтр по поставщику по всем 146 позициям журнала. */
export default function ItemsPage() {
  const items = useShelfItems();
  const on = useToday();
  const [filter, setFilter] = useState<ShelfFilter>(EMPTY_FILTER);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<ShelfItem | null>(null);

  const all = items ?? [];
  // Список поставщиков — из справочника (как в диалоге объединения), а не из
  // «сырых» написаний в товарах: полные юрлица из накладных в фильтр не попадают.
  const directory = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const suppliers = supplierOptions(all, directory);

  const visible = useMemo(() => {
    const byText = filterItems(all, filter, directory);
    return status === "all" ? byText : byText.filter((item) => item.status === status);
  }, [all, directory, filter, status]);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Весь журнал"
        title="Товары"
        action={<Badge variant="secondary">{visible.length}</Badge>}
      />

      <FilterBar
        filter={filter}
        onChange={setFilter}
        suppliers={suppliers}
        resultCount={visible.length}
        totalCount={all.length}
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatus(tab.id)}
            aria-pressed={status === tab.id}
            className={cn(
              "h-9 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors",
              status === tab.id
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-muted",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {items === undefined ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-20 animate-pulse rounded-lg bg-secondary/70" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Ничего не нашлось"
          description="Измените запрос, поставщика или статус."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setFilter({ query: "", supplier: ALL_SUPPLIERS });
                setStatus("all");
              }}
            >
              Сбросить фильтры
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => {
            const expiry = expiryInfo(item.expiresAt, on);
            const style = EXPIRY_STYLE[expiry.kind];
            const received = receivedLabel(item.receivedAt);
            const receivedMissing = received === "Поступление не указано";

            return (
              <li
                key={item.id}
                className="flex items-center gap-3 overflow-hidden rounded-lg border border-border bg-card p-3 pl-0 shadow-sm"
              >
                <span
                  aria-hidden
                  className="w-1.5 shrink-0 self-stretch"
                  style={{ backgroundColor: style.stripe }}
                  title={style.title}
                />

                <div className="flex min-w-0 flex-1 flex-col gap-1 pl-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <SupplierBadge supplier={item.supplier} />
                    <span className="text-xs text-muted-foreground">
                      годен до {formatRu(item.expiresAt)}
                    </span>
                    {/*
                      Дата поступления в списке нужна по той же причине, что и на
                      «Сроках»: две партии одного товара различаются только ею,
                      и без неё строки выглядели неотличимыми.
                    */}
                    <span
                      className={cn(
                        "text-xs",
                        receivedMissing ? "text-muted-foreground/70 italic" : "text-muted-foreground",
                      )}
                    >
                      {received}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(item)}
                    className="block w-full text-left text-sm font-semibold leading-snug hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.name}
                  </button>
                  <p className="text-xs text-muted-foreground">{expiry.headline}</p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge className={cn(style.chipClass)}>{STATUS_LABEL[item.status]}</Badge>
                  {item.rawExpires ? <Badge variant="outline">дата текстом</Badge> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <EditItemDialog item={editing} suppliers={suppliers} onClose={() => setEditing(null)} />
    </div>
  );
}
