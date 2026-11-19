import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ALL_SUPPLIERS, NO_SUPPLIER, type ShelfFilter } from "@/domain/filter";

/** Подпись пункта «Без поставщика» — в списке значение служебное, а текст человеческий. */
const NO_SUPPLIER_LABEL = "Без поставщика";

export interface FilterBarProps {
  filter: ShelfFilter;
  onChange: (filter: ShelfFilter) => void;
  /** Активные записи справочника; последним пунктом может стоять NO_SUPPLIER. */
  suppliers: string[];
  resultCount: number;
  totalCount: number;
}

/**
 * Поиск по названию и фильтр по поставщику — одинаковые на «Сроках», «Товарах»
 * и в архиве.
 */
export function FilterBar({ filter, onChange, suppliers, resultCount, totalCount }: FilterBarProps) {
  const isFiltered = filter.query.trim() !== "" || filter.supplier !== ALL_SUPPLIERS;
  const hasUnknown = suppliers.includes(NO_SUPPLIER);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={filter.query}
            onChange={(event) => onChange({ ...filter, query: event.target.value })}
            placeholder="Поиск по названию"
            aria-label="Поиск по названию"
            className="pl-9"
          />
        </div>

        {isFiltered ? (
          <Button
            variant="outline"
            size="icon"
            aria-label="Сбросить фильтр"
            onClick={() => onChange({ query: "", supplier: ALL_SUPPLIERS })}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={filter.supplier}
          onChange={(event) => onChange({ ...filter, supplier: event.target.value })}
          aria-label="Фильтр по поставщику"
          className="flex-1"
        >
          <option value={ALL_SUPPLIERS}>Все поставщики</option>
          {suppliers.map((supplier) => (
            <option key={supplier} value={supplier}>
              {supplier === NO_SUPPLIER ? NO_SUPPLIER_LABEL : supplier}
            </option>
          ))}
        </Select>

        <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
          {isFiltered ? `${resultCount} из ${totalCount}` : `всего ${totalCount}`}
        </p>
      </div>

      {/*
        «Сырое» имя из накладной — не поставщик, а нераспознанное написание.
        Говорим, что с ним делать, вместо того чтобы молча показывать его
        в списке рядом с чистым «Две Линии».
      */}
      {hasUnknown ? (
        <p className="text-xs text-muted-foreground">
          Есть товары с поставщиком, которого нет в справочнике, — они собраны в пункте
          «Без поставщика». Добавить их в справочник можно на экране «Добавить товар».
        </p>
      ) : null}
    </div>
  );
}
