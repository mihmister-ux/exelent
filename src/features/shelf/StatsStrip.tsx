import { EXPIRY_STYLE, type ExpiryKind } from "@/domain/expiry";
import { cn } from "@/lib/utils";

export interface StatTile {
  /** Ключ плитки: по нему же её и фильтруют. */
  id: string;
  label: string;
  value: number;
  /** Статус срока; null — нейтральная плитка. */
  tone: ExpiryKind | null;
  hint?: string;
}

export interface StatsStripProps {
  tiles: StatTile[];
  /** Выбранная плитка: подсвечена и объявлена нажатой. */
  active?: string | null;
  /** Если задано, плитка — кнопка-фильтр, а не просто число. */
  onSelect?: (id: string) => void;
}

/**
 * Сводка сверху — то же, что считал макрос `ОбновитьЖурнал`, но без запуска
 * по кнопке. Плитка белая и строгая: цвет статуса показывает полоса слева,
 * число и подпись остаются контрастными.
 *
 * Плитки нажимаются: «Просрочено 12» — это готовый фильтр, а ткнуть в число
 * на телефоне естественнее, чем искать тот же статус в списке групп.
 */
export function StatsStrip({ tiles, active = null, onSelect }: StatsStripProps) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {tiles.map((tile) => {
        const style = tile.tone ? EXPIRY_STYLE[tile.tone] : null;
        const selected = active === tile.id;

        const className = cn(
          "relative overflow-hidden rounded-lg border bg-card px-3 py-2.5 pl-4 text-left",
          selected ? "border-foreground/40 ring-1 ring-foreground/25" : "border-border",
          // Подсветку нажатой плитки задаёт кольцо, но фон тоже нужен: на
          // солнце кольцо читается плохо, а разница заливок видна.
          selected && "bg-secondary/60",
          onSelect &&
            "transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        );

        const body = (
          <>
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1.5"
              style={{ backgroundColor: style?.stripe ?? "#94a3b8" }}
            />
            <p className="font-mono text-2xl font-semibold leading-none tabular-nums">{tile.value}</p>
            <p className="mt-1 text-xs font-medium leading-tight">{tile.label}</p>
            {tile.hint ? (
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{tile.hint}</p>
            ) : null}
          </>
        );

        if (!onSelect) {
          return (
            <div key={tile.id} className={className}>
              {body}
            </div>
          );
        }

        return (
          <button
            key={tile.id}
            type="button"
            className={className}
            aria-pressed={selected}
            title={selected ? `Показать все позиции` : `Показать только: ${tile.label}`}
            onClick={() => onSelect(tile.id)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

/** Плашка статуса — нужна там, где полосы недостаточно (заголовки групп). */
export function StatusChip({ tone, children }: { tone: ExpiryKind; children: React.ReactNode }) {
  return (
    <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", EXPIRY_STYLE[tone].chip)}>
      {children}
    </span>
  );
}
