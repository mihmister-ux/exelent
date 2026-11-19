import { useEffect, useState } from "react";
import { ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { updateItem } from "@/db/repo";
import type { ShelfItem } from "@/db/types";
import { describeChestnyZnak, parseChestnyZnak } from "@/domain/chestny-znak";
import { DataMatrixScanner } from "@/features/scan/DataMatrixScanner";
import { SupplierField } from "@/features/shelf/SupplierField";

export interface EditItemDialogProps {
  item: ShelfItem | null;
  suppliers: string[];
  onClose: () => void;
}

/**
 * Кнопка «Изменить».
 *
 * Нужна прежде всего для строк, где в Excel в колонке D стоял не дата
 * (например «18.09..29» у «Пульмотаба»): приложение такую строку держит
 * в группе «Без срока» и показывает исходный текст, пока человек не впишет
 * настоящую дату. Файл-источник при этом не трогаем.
 */
export function EditItemDialog({ item, suppliers, onClose }: EditItemDialogProps) {
  const [name, setName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [marked, setMarked] = useState(false);
  const [markCode, setMarkCode] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setName(item.name);
    setSupplier(item.supplier);
    setReceivedAt(item.receivedAt ?? "");
    setExpiresAt(item.expiresAt ?? "");
    setMarked(item.marked);
    const existing = item.note?.startsWith("ЧЗ: ") ? item.note.slice(4) : "";
    setMarkCode(existing);
  }, [item]);

  const parsedMark = markCode ? parseChestnyZnak(markCode) : null;

  const handleDetected = (raw: string) => {
    const code = parseChestnyZnak(raw);
    setMarkCode(code.raw);
    setMarked(true);
    toast(
      code.looksLikeMarking
        ? `Марка прочитана: ${describeChestnyZnak(code)}`
        : "Код прочитан, но маркировкой не выглядит",
      code.looksLikeMarking ? "success" : "default",
    );
  };

  const options = supplier && !suppliers.includes(supplier) ? [...suppliers, supplier] : suppliers;

  const handleSave = async () => {
    if (!item) return;
    if (!name.trim()) {
      toast("Нельзя оставить товар без названия", "danger");
      return;
    }
    if (!supplier.trim()) {
      toast("Укажите поставщика", "danger");
      return;
    }

    setSaving(true);
    try {
      await updateItem(item.id, {
        name: name.trim(),
        supplier: supplier.trim(),
        receivedAt: receivedAt || null,
        expiresAt: expiresAt || null,
        marked,
        note: markCode ? `ЧЗ: ${markCode}` : item.note ?? null,
        // Настоящую дату вписали — исходный текст из журнала больше не нужен.
        rawExpires: expiresAt ? null : item.rawExpires ?? null,
      });
      toast("Изменения сохранены", "success");
      onClose();
    } catch (error) {
      toast(`Не удалось сохранить: ${String(error)}`, "danger");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      title="Изменить позицию"
      description={
        item?.rawExpires
          ? `В журнале Excel здесь стояло «${item.rawExpires}» — впишите настоящую дату.`
          : "Правки сохраняются в приложении; файл Excel не меняется."
      }
    >
      <div className="space-y-4">
        {item?.rawExpires && !expiresAt ? (
          <p className="rounded-xl bg-warning/70 px-3 py-2 text-xs text-[#1a1714]">
            Пока дата не указана, позиция остаётся в группе «Без срока».
          </p>
        ) : null}

        <Field label="Наименование товара">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <SupplierField value={supplier} onChange={setSupplier} options={options} />

        {/*
          Дата поступления правится руками: в журнале Excel её заполняли не
          везде, а именно она отличает две приёмки одного товара с одним сроком
          друг от друга. Пустое поле — «партия без даты», это допустимо.
        */}
        <Field
          label="Поступление"
          hint="Дата приёмки партии — по ней различаются две поставки одного товара."
        >
          <Input
            type="date"
            value={receivedAt}
            onChange={(event) => setReceivedAt(event.target.value)}
          />
        </Field>

        <Field label="Годен до" hint="Пустое поле — позиция вернётся в группу «Без срока».">
          <Input
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </Field>

        <div className="space-y-2">
          <label className="flex items-center gap-3 rounded-xl border border-input bg-card px-3 py-3">
            <input
              type="checkbox"
              className="size-5 accent-[#1a1714]"
              checked={marked}
              onChange={(event) => setMarked(event.target.checked)}
            />
            <span className="text-sm font-medium">Честный знак (маркировка)</span>
          </label>

          <Button type="button" variant="outline" className="w-full" onClick={() => setScanOpen(true)}>
            <ScanLine className="size-4" /> Сканировать марку камерой
          </Button>

          {markCode ? (
            <div className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs">
              <p className="font-medium">{parsedMark ? describeChestnyZnak(parsedMark) : "Код"}</p>
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{markCode}</p>
              <button
                type="button"
                className="mt-1 text-destructive underline"
                onClick={() => {
                  setMarkCode("");
                  setMarked(false);
                }}
              >
                Очистить код
              </button>
            </div>
          ) : null}
        </div>

        {item?.excelRow ? (
          <p className="text-xs text-muted-foreground">
            Из журнала: лист «{item.excelSheet}», строка {item.excelRow}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
        </div>
      </div>

      <DataMatrixScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={handleDetected}
      />
    </Dialog>
  );
}
