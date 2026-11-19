import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import type { Supplier } from "@/db/types";
import { SUPPLIER_PALETTE, isSupplierNameTaken } from "@/domain/suppliers";
import { cn } from "@/lib/utils";

export interface SupplierEditorProps {
  open: boolean;
  onClose: () => void;
  /** Весь справочник — нужен, чтобы не дать занять чужое имя. */
  directory: readonly Supplier[];
  /** Что редактируем; пусто — заводим нового. */
  supplier?: Supplier | null;
  /** Цвет для новой записи: следующий свободный в палитре. */
  suggestedColor: string;
  onSave: (draft: { name: string; color: string }) => Promise<void>;
}

/**
 * Один диалог на «добавить» и «редактировать»: поля те же, отличается только
 * заголовок и предзаполнение. Разводить их по двум окнам незачем — человек
 * видит одну и ту же форму и не ищет, где что.
 *
 * Имя при правке меняет и написание у связанных товаров (это делает
 * `putSupplier`), поэтому прямо в окне предупреждаем, что связи переедут.
 */
export function SupplierEditor({
  open,
  onClose,
  directory,
  supplier,
  suggestedColor,
  onSave,
}: SupplierEditorProps) {
  const editing = Boolean(supplier);
  const [name, setName] = useState("");
  const [color, setColor] = useState(suggestedColor);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  // Открыли окно — заполнили поля тем, что редактируем. Без этого повторный
  // вход в «Редактировать» показал бы прошлые значения.
  useEffect(() => {
    if (!open) return;
    setName(supplier?.name ?? "");
    setColor(supplier?.color ?? suggestedColor);
    setTouched(false);
    setBusy(false);
  }, [open, supplier, suggestedColor]);

  const trimmed = name.trim();
  const problem = useMemo(() => {
    if (!trimmed) return "Введите название поставщика";
    if (isSupplierNameTaken(directory, trimmed, supplier?.id)) {
      return "Такой поставщик уже есть в справочнике";
    }
    return null;
  }, [directory, supplier?.id, trimmed]);

  const renamed = Boolean(
    supplier && trimmed && trimmed.toLowerCase() !== supplier.name.toLowerCase(),
  );

  async function submit() {
    setTouched(true);
    if (problem) return;
    setBusy(true);
    try {
      await onSave({ name: trimmed, color });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={editing ? "Поставщик" : "Новый поставщик"}
      description={
        editing
          ? "Название и цвет. Связи с товарами сохранятся."
          : "Появится в списке поставщиков и в фильтрах."
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Название">
          <Input
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Лотос"
            aria-invalid={touched && problem ? true : undefined}
          />
        </Field>

        {touched && problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Цвет</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Цвет поставщика">
            {SUPPLIER_PALETTE.map((option) => {
              const selected = option.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setColor(option)}
                  aria-label={`Цвет ${option}`}
                  aria-pressed={selected}
                  style={{ backgroundColor: option }}
                  className={cn(
                    "size-8 rounded-full ring-offset-2 ring-offset-card transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "ring-2 ring-foreground" : "hover:scale-105",
                  )}
                />
              );
            })}
          </div>
        </div>

        {renamed && supplier ? (
          <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-xs text-muted-foreground">
            Все товары, привязанные к «{supplier.name}», станут «{trimmed}». Прежнее название
            останется в синонимах — старые накладные продолжат его находить.
          </p>
        ) : null}

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={busy}
          >
            Отмена
          </Button>
          <Button type="submit" className="flex-1" disabled={Boolean(problem) || busy}>
            {busy ? "Сохраняем…" : editing ? "Сохранить" : "Добавить"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
