import { useLiveQuery } from "dexie-react-hooks";

import { cn } from "@/lib/utils";
import { db } from "@/db/db";
import {
  buildSupplierIndex,
  findSupplier,
  NO_SUPPLIER_LABEL,
  supplierShortFrom,
  supplierToneFrom,
} from "@/domain/suppliers";

/**
 * Плашка поставщика: фирменный цвет фона плюс название.
 * Цвет нужен для быстрого сканирования, название — чтобы не запоминать,
 * кто есть кто. Поэтому это не просто кружок.
 *
 * Поставщика, которого нет в справочнике, показываем как «Без поставщика»:
 * «сырое» имя из накладной с ИНН и адресом в плашке не читается, а в списке
 * создаёт ощущение второго поставщика.
 */
export function SupplierBadge({
  supplier,
  size = "default",
  className,
}: {
  supplier: string;
  size?: "default" | "sm";
  className?: string;
}) {
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const tone = supplierToneFrom(suppliers, supplier);
  const known = findSupplier(buildSupplierIndex(suppliers), supplier) !== null;
  const label = suppliers.length > 0 && !known ? NO_SUPPLIER_LABEL : supplierShortFrom(suppliers, supplier);

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-md font-semibold uppercase tracking-wide",
        size === "default" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[10px]",
        className,
      )}
      style={{ backgroundColor: tone.bg, color: tone.fg }}
      aria-label={label}
      title={known || suppliers.length === 0 ? supplier : `${NO_SUPPLIER_LABEL} · ${supplier}`}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
