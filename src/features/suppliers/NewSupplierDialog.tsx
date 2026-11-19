import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Info, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { db } from "@/db/db";
import { addSupplier } from "@/db/suppliers";
import type { Supplier } from "@/db/types";
import { cleanSupplierName } from "@/domain/supplier-name";
import { isSupplierNameTaken, nextSupplierColor, nextSupplierOrder } from "@/domain/suppliers";

/**
 * «Создать нового поставщика».
 *
 * Запись в справочнике заводится только отсюда — по явному действию человека.
 * Раньше её создавал импорт накладной: имя из файла («ООО "ПКФ "ДВЕ ЛИНИИ",
 * ИНН …») молча становилось новым поставщиком, и вкладки с фильтрами
 * наполнялись огрызками реквизитов.
 *
 * Имя чистим тем же `cleanSupplierName`, что и весь проект: в справочник
 * уходит ядро («Две Линии»), а не строка из накладной. Занятое имя не
 * пропускаем — иначе один поставщик снова раздвоится.
 */

export interface NewSupplierDialogProps {
  open: boolean;
  onClose: () => void;
  /** Что подставить в поле: поставщик из накладной, которого нет в справочнике. */
  initialName?: string;
  /** Готовая запись справочника — вызывающий может сразу её выбрать. */
  onCreated: (supplier: Supplier) => void;
}

export function NewSupplierDialog({ open, onClose, initialName = "", onCreated }: NewSupplierDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Новый поставщик"
      description="Запись появится во вкладках и фильтрах журнала. Цвет назначится автоматически."
    >
      {/* Форма монтируется заново на каждое открытие: поля не помнят прошлый ввод. */}
      {open ? (
        <NewSupplierForm initialName={initialName} onClose={onClose} onCreated={onCreated} />
      ) : null}
    </Dialog>
  );
}

function NewSupplierForm({
  initialName,
  onClose,
  onCreated,
}: Omit<NewSupplierDialogProps, "open"> & { initialName: string }) {
  const directory = useLiveQuery(() => db.suppliers.toArray(), [], []);

  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  const typed = name.trim();
  // Пустое после чистки имя (одни реквизиты) оставляем как ввёл человек:
  // без него позиции не за что зацепиться.
  const cleaned = cleanSupplierName(typed) || typed;
  const taken = typed !== "" && isSupplierNameTaken(directory, cleaned);

  const error = typed === "" ? "" : taken ? "Такая запись уже есть в справочнике." : "";

  const submit = async () => {
    if (typed === "") {
      toast("Впишите название поставщика", "danger");
      return;
    }
    if (taken) {
      toast(`«${cleaned}» уже есть в справочнике — выберите его в списке`, "danger");
      return;
    }

    setBusy(true);
    try {
      const supplier = await addSupplier({
        name: cleaned,
        color: nextSupplierColor(directory),
        aliases: cleaned === typed ? [] : [typed],
        hidden: false,
        order: nextSupplierOrder(directory),
      });
      toast(`Поставщик «${supplier.name}» создан`, "success");
      onCreated(supplier);
      onClose();
    } catch (cause) {
      toast(`Не удалось создать поставщика: ${String(cause)}`, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Field
        label="Название"
        hint="«ООО», ИНН и адрес уберутся сами — в журнал уйдёт короткое имя."
      >
        <Input
          value={name}
          autoFocus
          placeholder="Например: Ромашка"
          aria-invalid={error ? true : undefined}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </Field>

      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}

      {/* Показываем, что именно попадёт в справочник: имя чистится, и это не всегда очевидно. */}
      {cleaned !== typed && cleaned !== "" ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            В справочник уйдёт «<strong className="text-foreground">{cleaned}</strong>», исходное написание
            сохранится как вариант для поиска.
          </span>
        </p>
      ) : null}

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={busy}>
          Отмена
        </Button>
        <Button className="flex-1" onClick={() => void submit()} disabled={busy || typed === "" || taken}>
          <UserPlus className="size-4" />
          {busy ? "Создаём…" : "Создать"}
        </Button>
      </div>
    </div>
  );
}
