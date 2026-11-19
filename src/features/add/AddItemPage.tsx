import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, Save, ScanLine } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { db } from "@/db/db";
import { addItem } from "@/db/repo";
import { describeChestnyZnak, parseChestnyZnak } from "@/domain/chestny-znak";
import { EXPIRY_STYLE, expiryInfo } from "@/domain/expiry";
import { supplierOptions } from "@/domain/filter";
import { formatRu, toISODate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DataMatrixScanner } from "@/features/scan/DataMatrixScanner";
import { SupplierField } from "@/features/shelf/SupplierField";
import { useShelfItems, useToday } from "@/features/shelf/useShelf";

/**
 * «Добавить товар» — четыре поля вместо девяти колонок.
 * Дата поступления подставляется сегодняшней, как и просили в ТЗ.
 */
export default function AddItemPage() {
  const items = useShelfItems();
  const on = useToday();
  const navigate = useNavigate();

  const directory = useLiveQuery(() => db.suppliers.toArray(), [], []);
  // Выбор поставщика — из справочника: «сырые» написания из накладных в списке
  // не нужны, это работа диалога объединения, а не поля ввода.
  const suppliers = supplierOptions(items ?? [], directory);
  const [name, setName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [receivedAt, setReceivedAt] = useState(toISODate(on));
  const [marked, setMarked] = useState(false);
  const [markCode, setMarkCode] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Статус считается на лету — то же, что показывала колонка F и подсветка.
  const preview = expiryInfo(expiresAt || null, on);
  const previewStyle = EXPIRY_STYLE[preview.kind];
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

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast("Впишите наименование товара", "danger");
      return;
    }
    if (!supplier.trim()) {
      toast("Выберите поставщика", "danger");
      return;
    }

    setSaving(true);
    try {
      const id = await addItem({
        name: name.trim(),
        supplier: supplier.trim(),
        expiresAt: expiresAt || null,
        receivedAt: receivedAt || null,
        marked,
        note: markCode ? `ЧЗ: ${markCode}` : null,
        status: "in_stock",
        source: "manual",
      });
      if (id === null) {
        toast("Такая позиция уже есть в наличии — добавьте новый срок, если это другая партия", "danger");
        return;
      }
      toast(`«${name.trim().slice(0, 30)}» добавлен`, "success");
      navigate("/");
    } catch (error) {
      toast(`Не удалось сохранить: ${String(error)}`, "danger");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Новая позиция" title="Добавить товар" />

      <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <Field label="Наименование товара" hint="Как написано на упаковке — по этому полю ищем потом.">
          <Input
            value={name}
            autoFocus
            placeholder="Например: Конфеты шоколадные, 140 г"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <SupplierField value={supplier} onChange={setSupplier} options={suppliers} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Годен до" hint="Ключевое поле: из него считаются все статусы.">
            <Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </Field>

          <Field label="Дата поступления" hint="По умолчанию сегодня — можно поправить.">
            <Input
              type="date"
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </Field>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-3 rounded-xl border border-input bg-background/60 px-3 py-3">
            <input
              type="checkbox"
              className="size-5 accent-[#1a1714]"
              checked={marked}
              onChange={(event) => setMarked(event.target.checked)}
            />
            <span className="text-sm font-medium">Честный знак (маркировка)</span>
          </label>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setScanOpen(true)}
          >
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

        <div className="flex overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {/* Тот же язык, что в списке: цвет статуса полосой и плашкой. */}
          <span
            aria-hidden
            className="w-1.5 shrink-0"
            style={{ backgroundColor: previewStyle.stripe }}
          />
          <div className={cn("flex-1 px-3 py-2.5 text-sm", previewStyle.tint)}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Статус сразу после добавления</p>
              <span
                className={cn(
                  "shrink-0 rounded px-2 py-1 text-[11px] font-semibold leading-none",
                  previewStyle.chip,
                )}
              >
                {preview.headline}
              </span>
            </div>
            <p className="mt-1.5">
              {expiresAt
                ? `Годен до ${formatRu(expiresAt)} · группа «${previewStyle.title}»`
                : "Без даты позиция попадёт в группу «Без срока» — её нужно будет уточнить."}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleSubmit} disabled={saving}>
            <Save className="size-4" />
            {saving ? "Сохраняем…" : "Добавить в журнал"}
          </Button>
          <Button variant="outline" onClick={() => navigate("/")} disabled={saving}>
            Отмена
          </Button>
        </div>
      </div>

      <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <CalendarPlus className="mt-0.5 size-4 shrink-0" />
        <span>
          «Дата поступления» и «Честный знак» нужны только для журнала: на расчёт сроков они
          не влияют.
        </span>
      </p>

      <DataMatrixScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={handleDetected}
      />
    </div>
  );
}
