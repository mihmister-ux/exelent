import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import type { Supplier } from "@/db/types";
import { plural } from "@/lib/utils";

export interface SupplierDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  /** Кого удаляем. */
  supplier: Supplier | null;
  /** Сколько товаров под ним (всех, а не только в наличии). */
  count: number;
  /**
   * Куда можно перенести — активные записи, кроме удаляемой.
   */
  targets: readonly Supplier[];
  /** Удалить с переносом (`targetId`) или без поставщика (`null`). */
  onConfirm: (targetId: string | null) => Promise<void>;
  /** Выход без потерь: запись уйдёт в архив, связи останутся. */
  onArchive: () => Promise<void>;
}

/**
 * Удаление поставщика с переносом товаров.
 *
 * Три разных случая, и текст обязан их различать — иначе человек либо
 * переносит товары туда, где их не ждут, либо теряет связь молча:
 *
 *   1) товаров нет — просто подтверждение;
 *   2) товары есть и есть куда переносить — выбор, кому их отдать;
 *   3) товары есть, но поставщик в справочнике один — переносить некуда.
 *      Честно предупреждаем, что позиции останутся без поставщика, и
 *      предлагаем вместо этого архивацию: она без потерь.
 */
export function SupplierDeleteDialog({
  open,
  onClose,
  supplier,
  count,
  targets,
  onConfirm,
  onArchive,
}: SupplierDeleteDialogProps) {
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmedEmpty, setConfirmedEmpty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetId(targets[0]?.id ?? "");
    setBusy(false);
    setConfirmedEmpty(false);
  }, [open, targets]);

  if (!supplier) return null;

  const orphans = count > 0 && targets.length === 0;
  const canSubmit = count === 0 || orphans ? confirmedEmpty || count === 0 : Boolean(targetId);

  async function submit() {
    setBusy(true);
    try {
      await onConfirm(count > 0 && targets.length > 0 ? targetId : null);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function archiveInstead() {
    setBusy(true);
    try {
      await onArchive();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={`Удалить поставщика «${supplier.name}»?`}
      description={
        count === 0
          ? "Товаров у него нет — удаление ничего не затронет."
          : `У него ${count} ${plural(count, "товар", "товара", "товаров")}. Их нужно куда-то деть.`
      }
    >
      <div className="space-y-3">
        {orphans ? (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
          >
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Переносить товары некуда — других поставщиков в справочнике нет. Если удалить,
                все <strong>{count}</strong> {plural(count, "позиция", "позиции", "позиций")}{" "}
                останутся <strong>без поставщика</strong>: пропадут из вкладок и фильтров по
                поставщику, хотя история сохранится.
              </span>
            </p>
            <p className="pl-6 text-xs">
              Без потерь — «Архивировать»: запись просто уйдёт из списков, связи останутся.
            </p>
          </div>
        ) : null}

        {count > 0 && targets.length > 0 ? (
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Кому перенести товары</span>
            <Select
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              aria-label="Кому перенести товары"
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </Select>
            <span className="block text-xs text-muted-foreground">
              Переедут все {count} {plural(count, "позиция", "позиции", "позиций")} — включая
              проданные и списанные, чтобы отчёты не потеряли историю.
            </span>
          </label>
        ) : null}

        {orphans ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmedEmpty}
              onChange={(event) => setConfirmedEmpty(event.target.checked)}
              className="mt-0.5 size-4 shrink-0"
            />
            <span>Да, удалить: товары станут БЕЗ ПОСТАВЩИКА</span>
          </label>
        ) : null}

        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => void (orphans ? archiveInstead() : onClose())}
            disabled={busy}
          >
            {orphans ? "Архивировать вместо" : "Отмена"}
          </Button>
          <Button
            variant={orphans ? "danger" : "default"}
            className="flex-1"
            onClick={() => void submit()}
            disabled={!canSubmit || busy}
          >
            {busy ? "Удаляем…" : "Удалить"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
