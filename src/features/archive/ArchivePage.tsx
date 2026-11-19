import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PackageSearch, RotateCcw, Printer } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { db } from "@/db/db";
import { returnToStock } from "@/db/repo";
import { isWrittenOff, STATUS_LABEL, type ShelfItem, type ShelfStatus } from "@/db/types";
import {
  ALL_SUPPLIERS,
  EMPTY_FILTER,
  filterItems,
  supplierOptions,
  type ShelfFilter,
} from "@/domain/filter";
import { summarize } from "@/domain/groups";
import { receivedShort } from "@/domain/received";
import { formatRu } from "@/lib/dates";
import { cn, errorText } from "@/lib/utils";
import { FilterBar } from "@/features/shelf/FilterBar";
import { useShelfItems, useToday } from "@/features/shelf/useShelf";
import { printWriteOffAct } from "@/features/print/print";

/**
 * «Архив / выбывшие» — это колонка G «Выбыл» из журнала, только отдельным
 * экраном. В Excel строка со значением «продан» оставалась в таблице и
 * попадала в итоги `ОбновитьЖурнал`; здесь она уходит из «Сроков», но
 * никуда не удаляется: позицию можно вернуть в наличие.
 *
 * Поиск и фильтр по поставщику — тот же `FilterBar`, что на «Сроках» и
 * «Товарах»: в архиве сотни строк, и «Вернуть» искали перебором глазами.
 */
export default function ArchivePage() {
  const items = useShelfItems();
  const on = useToday();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<ShelfStatus | null>(null);
  const [filter, setFilter] = useState<ShelfFilter>(EMPTY_FILTER);

  const all = items ?? [];
  const directory = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const summary = summarize(all, on);

  const written = useMemo(
    () =>
      all
        .filter(isWrittenOff)
        .sort((a, b) => (b.soldAt ?? b.writtenOffAt ?? "").localeCompare(a.soldAt ?? a.writtenOffAt ?? "")),
    [all],
  );

  const sold = written.filter((item) => item.status === "sold").length;
  const writtenOff = written.filter((item) => item.status === "written_off").length;

  const byStatus = status ? written.filter((item) => item.status === status) : written;
  const visible = filterItems(byStatus, filter, directory);
  const suppliers = supplierOptions(written, directory);

  const handleRestore = async (item: ShelfItem) => {
    setBusyId(item.id);
    try {
      await returnToStock(item.id);
      toast(`«${item.name.slice(0, 30)}» снова в наличии`, "success");
    } catch (error) {
      // Раньше отказ записи тонул в консоли: позиция просто оставалась в архиве,
      // и кнопку «Вернуть» нажимали ещё раз.
      toast(`Не удалось вернуть «${item.name.slice(0, 30)}»: ${errorText(error)}`, "danger");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Проданные и списанные"
        title="Архив / выбывшие"
        action={<Badge variant="secondary">{summary.writtenOff}</Badge>}
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Всего позиций" value={summary.total} />
        <Tile label="В наличии" value={summary.total - summary.writtenOff} />
        {/* «Продано» и «Списано» — кнопки: это готовые фильтры списка ниже. */}
        <FilterTile
          label="Продано"
          value={sold}
          active={status === "sold"}
          onClick={() => setStatus((current) => (current === "sold" ? null : "sold"))}
        />
        <FilterTile
          label="Списано"
          value={writtenOff}
          active={status === "written_off"}
          onClick={() => setStatus((current) => (current === "written_off" ? null : "written_off"))}
        />
      </div>

      <p className="rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
        Итоги пересчитываются сразу — это работа макроса «ОбновитьЖурнал», который в Excel надо
        было запускать кнопкой.
      </p>

      {writtenOff > 0 ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => printWriteOffAct(written)}
        >
          <Printer className="size-4" />
          Акт списания ({writtenOff})
        </Button>
      ) : null}

      {items === undefined ? (
        <div className="space-y-2" aria-busy>
          {[0, 1].map((row) => (
            <div key={row} className="h-20 animate-pulse rounded-lg bg-secondary/70" />
          ))}
        </div>
      ) : written.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          title="Выбывших пока нет"
          description="Сюда попадут позиции после кнопки «Продано» или «Списать». Из Excel уже перенесено 16 проданных строк."
        />
      ) : (
        <>
          <FilterBar
            filter={filter}
            onChange={setFilter}
            suppliers={suppliers}
            resultCount={visible.length}
            totalCount={byStatus.length}
          />

          {visible.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="Ничего не нашлось"
              description="Попробуйте изменить запрос или выбрать другого поставщика."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilter({ query: "", supplier: ALL_SUPPLIERS });
                    setStatus(null);
                  }}
                >
                  Сбросить фильтр
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {visible.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug">{item.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.supplier} · годен до {formatRu(item.expiresAt)} ·{" "}
                      {receivedShort(item.receivedAt)}
                      {item.status === "sold" && item.soldAt
                        ? ` · продан ${formatRu(dayOf(item.soldAt))}`
                        : ""}
                      {item.status === "written_off" && item.writtenOffAt
                        ? ` · списан ${formatRu(dayOf(item.writtenOffAt))}`
                        : ""}
                    </p>
                  </div>

                  <Badge variant={item.status === "sold" ? "secondary" : "outline"}>
                    {STATUS_LABEL[item.status]}
                  </Badge>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 shrink-0"
                    disabled={busyId === item.id}
                    aria-label={`Вернуть в наличие: ${item.name}`}
                    onClick={() => handleRestore(item)}
                  >
                    <RotateCcw className="size-3.5" />
                    Вернуть
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="font-mono text-2xl font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-medium leading-tight">{label}</p>
    </div>
  );
}

/**
 * Плитка-фильтр: то же оформление, что у соседних итогов, но нажимается —
 * «Продано 16» так и просится под палец, чтобы посмотреть именно их.
 */
function FilterTile({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={active ? "Показать все" : `Показать только: ${label}`}
      onClick={onClick}
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-foreground/40 bg-secondary/60 ring-1 ring-foreground/25" : "border-border",
      )}
    >
      <p className="font-mono text-2xl font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-medium leading-tight">{label}</p>
    </button>
  );
}

/**
 * Новые записи хранят дату продажи календарным днём (YYYY-MM-DD), но у строк,
 * отмеченных до этой правки, там полный ISO-таймштамп — и `formatRu` его не
 * разберёт. Для показа в обоих случаях достаточно первых десяти знаков.
 */
function dayOf(value: string): string {
  return value.slice(0, 10);
}
