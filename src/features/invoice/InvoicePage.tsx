import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  RotateCcw,
  Upload,
  UserPlus,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { addItems } from "@/db/repo";
import type { ShelfItemDraft, Supplier } from "@/db/types";
import { parseInvoice, type InvoiceRow, type InvoiceParseResult } from "@/domain/invoice";
import { cleanSupplierName } from "@/domain/supplier-name";
import { activeSuppliers, buildSupplierIndex, findSupplier } from "@/domain/suppliers";
import { formatRu, toISODate } from "@/lib/dates";
import { readPdf } from "@/lib/pdf";
import { UNREADABLE_FILE, isExcelName, readWorkbook, type SheetGrid } from "@/lib/xlsx";
import { cn } from "@/lib/utils";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { NewSupplierDialog } from "@/features/suppliers/NewSupplierDialog";

/** Загрузка накладной: Excel и текстовый PDF, без сервера и без отправки файла наружу. */

interface PickedFile {
  name: string;
  size: number;
  /** Чем читаем файл — от этого зависит и текст подсказок. */
  kind: "excel" | "pdf";
}

/** Ключ строки в предпросмотре: её номер уникален только внутри одного листа. */
function rowKey(row: InvoiceRow): string {
  return `${row.sheet}#${row.sourceRow}`;
}

interface ParsedState {
  file: PickedFile;
  result: InvoiceParseResult;
  /** Дата поступления партии (ISO, YYYY-MM-DD) — одна на всю накладную. Обязательна. */
  receivedAt: string;
  /**
   * Выбранный поставщик — это `Supplier.id` из справочника.
   * `null` — человек ещё не трогал список, действует предвыбор из файла;
   * `""` — сознательно очистил, и подсказка не должна возвращаться.
   */
  supplierId: string | null;
  /** Строки, которые человек убрал из предпросмотра перед записью. */
  excluded: Set<string>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function shortName(name: string, limit = 40): string {
  return name.length > limit ? `${name.slice(0, limit - 1)}…` : name;
}

/** Значение ячейки строкой без пробелов: пусто приходит и как null, и как "". */
function cellText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** Русские формы счётного слова: без них в интерфейсе выходит «пропущено 1 строк». */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const tail100 = Math.abs(n) % 100;
  if (tail100 >= 11 && tail100 <= 14) return many;
  switch (Math.abs(n) % 10) {
    case 1:
      return one;
    case 2:
    case 3:
    case 4:
      return few;
    default:
      return many;
  }
}

const rowsWord = (n: number) => pluralRu(n, "строка", "строки", "строк");
const sheetsWord = (n: number) => pluralRu(n, "лист", "листа", "листов");

/** Первые номера пропущенных строк: список из сотни номеров раздул бы экран. */
const SKIPPED_PREVIEW = 12;
/** Ниже 70% разбор мог принять за товары не то — подсвечиваем акцентом. */
const LOW_CONFIDENCE = 70;

/**
 * Количество, единица и цена одной читаемой строкой — «5 шт · 365,00 ₽».
 * Полей quantity/unit в ShelfItem нет, поэтому в журнале они живут в примечании:
 * кладовщику важно видеть, сколько пришло по накладной.
 */
function measurementLine(row: InvoiceRow): string | null {
  const parts: string[] = [];
  const quantity = cellText(row.quantity);
  // Одна единица без количества («шт») смысла не несёт — идёт только парой.
  if (quantity) parts.push([quantity, cellText(row.unit)].filter(Boolean).join(" "));
  const price = cellText(row.price);
  if (price) parts.push(`${price} ₽`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Подпись галочки одинакова и в таблице, и в карточке на телефоне. */
function rowCheckboxLabel(row: InvoiceRow): string {
  return `Включить строку ${row.sheet} · ${row.sourceRow}: ${shortName(row.name, 25)}`;
}

/** Часть примечания вида «подпись значение»: пустые ячейки просто выпадают. */
function notePart(label: string, value: string | number | null | undefined): string | null {
  const text = cellText(value);
  return text ? `${label} ${text}` : null;
}

export default function InvoicePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], []);

  const [file, setFile] = useState<PickedFile | null>(null);
  const [parsed, setParsed] = useState<ParsedState | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDragging, setDragging] = useState(false);

  const accept =
    ".xlsx,.xls,.xlsm,.pdf,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const clear = () => {
    setFile(null);
    setParsed(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const pick = async (picked: File | null | undefined) => {
    if (!picked) return;

    const isPdf = /\.pdf$/i.test(picked.name);
    if (!isPdf && !isExcelName(picked.name)) {
      toast("Принимаем Excel (.xlsx, .xls, .xlsm) и PDF", "danger");
      return;
    }

    const selected: PickedFile = { name: picked.name, size: picked.size, kind: isPdf ? "pdf" : "excel" };
    setFile(selected);
    setParsed(null);
    setBusy(true);

    try {
      // PDF даёт ту же сетку, что Excel, поэтому дальше путь общий:
      // разбор таблицы, предпросмотр и запись не знают, откуда пришли строки.
      const sheets: SheetGrid[] = isPdf ? await readPdf(picked) : await readWorkbook(picked);

      if (isPdf && sheets.every((sheet) => "looksScanned" in sheet && sheet.looksScanned)) {
        toast("В PDF нет текстового слоя — это скан. Нужен текстовый PDF или Excel", "danger");
        return;
      }

      const result = parseInvoice(sheets);

      if (!result || result.rows.length === 0) {
        // Отличаем «книга пустая» от «структура не та»: в первой нет ни одного
        // непустого значения, это обычно пересохранённый с нуля или битый файл.
        const hasAnyValue = sheets.some((sheet) =>
          sheet.rows.some((row) => row.some((cell) => cell !== null && String(cell).trim() !== "")),
        );
        toast(
          hasAnyValue
            ? "Не нашёл таблицу товаров: проверьте, есть ли колонки «Наименование» и «Кол-во»"
            : UNREADABLE_FILE,
          "danger",
        );
        return;
      }

      /*
        Поставщика из файла НЕ применяем. Раньше здесь считалось самое частое
        написание, оно подставлялось в поле и уезжало в журнал — вместе с
        автоматическим созданием записи справочника по строке накладной. Из-за
        этого один поставщик («ГРИНФИТО ООО» в журнале и «Гринфито» в накладной)
        расползался по вкладкам новыми записями.

        Теперь файл только ПОДСКАЗЫВАЕТ, кого выбрать в списке: сопоставление
        делает `suggestedSupplier` ниже, а запись происходит по кнопке и только
        для выбранной из справочника записи.
      */
      setParsed({
        file: selected,
        result,
        // Дата поступления — день фактической приёмки, по умолчанию сегодня.
        // Дата документа из накладной остаётся подсказкой (см. `fileDate`),
        // а не значением: приёмка и выписка счёта — разные дни.
        receivedAt: toISODate(new Date()),
        supplierId: null,
        excluded: new Set(),
      });
      const where = result.sheets.length > 1
        ? `на ${result.sheets.length} листах`
        : `на листе «${result.sheet}»`;
      toast(`Нашёл ${result.rows.length} строк ${where}`, "success");
    } catch (error) {
      // readWorkbook уже отдаёт готовую фразу для человека. Всё остальное
      // (PDF не разобрался, файл не дал байтов) показываем тем же текстом:
      // человеку нужен выход, а не имя класса ошибки. Причину пишем в консоль.
      if (!(error instanceof Error && error.message === UNREADABLE_FILE)) {
        console.error("не удалось прочитать файл", picked.name, error);
      }
      toast(UNREADABLE_FILE, "danger");
    } finally {
      setBusy(false);
    }
  };

  const included = useMemo(
    () => parsed?.result.rows.filter((row) => !parsed.excluded.has(rowKey(row))) ?? [],
    [parsed],
  );

  const warnings = useMemo(() => included.filter((row) => row.warning), [included]);

  const toggleRow = (key: string) => {
    setParsed((current) => {
      if (!current) return current;
      const excluded = new Set(current.excluded);
      if (excluded.has(key)) excluded.delete(key);
      else excluded.add(key);
      return { ...current, excluded };
    });
  };

  const supplierNamesForPicker = useMemo(() => activeSuppliers(suppliers), [suppliers]);

  /*
    Поставщик из файла как «сырое» написание: «ГРИНФИТО ООО» или полное юрлицо
    с ИНН. Показываем человеку, но в журнал он не попадает никогда.
  */
  const fileSupplierRaw = parsed?.result.supplier?.trim() ?? "";
  const fileSupplierPretty = fileSupplierRaw ? cleanSupplierName(fileSupplierRaw) || fileSupplierRaw : "";

  /*
    Предвыбор: находим в справочнике запись, которой соответствует написание из
    файла. Сравнение идёт по имени и алиасам, то есть «ГРИНФИТО ООО» находит
    «Гринфито» — но это только подставленное значение в списке. Ничего не
    записывается, пока человек не нажмёт «Добавить в журнал».
  */
  const suggestedSupplier = useMemo<Supplier | null>(() => {
    if (!fileSupplierRaw) return null;
    return findSupplier(buildSupplierIndex(supplierNamesForPicker), fileSupplierRaw);
  }, [fileSupplierRaw, supplierNamesForPicker]);

  // `??` — не `||`: пустая строка означает «человек очистил выбор», и подсказка
  // не должна возвращаться на место.
  const chosenSupplierId = parsed ? (parsed.supplierId ?? suggestedSupplier?.id ?? "") : "";
  const chosenSupplier = suppliers.find((supplier) => supplier.id === chosenSupplierId) ?? null;

  /** Дата документа из накладной — подсказка, а не значение поля. */
  const fileDate = parsed?.result.documentDate ?? null;

  const [newSupplierOpen, setNewSupplierOpen] = useState(false);

  const handleAdd = async () => {
    if (!parsed) return;
    if (included.length === 0) {
      toast("Не осталось строк для записи", "danger");
      return;
    }
    // Поставщика выбирает человек: раньше он подставлялся из файла, и позиция
    // могла уехать к «поставщику», которого в справочнике нет.
    if (!chosenSupplier) {
      toast("Выберите поставщика из справочника", "danger");
      return;
    }
    if (!parsed.receivedAt) {
      toast("Укажите дату поступления партии — без неё партии не различить", "danger");
      return;
    }

    setBusy(true);
    try {
      /*
        И поставщик, и дата поступления — одни на всю накладную: это одна
        приёмка. `supplierId` пишем явно, чтобы связь с справочником не
        зависела от написания имени; `supplier` — чтобы позиция читалась в
        журнале и фильтрах до любой накатки.
      */
      const drafts: ShelfItemDraft[] = included.map((row) => ({
        name: row.name,
        supplier: chosenSupplier.name,
        supplierId: chosenSupplier.id,
        receivedAt: parsed.receivedAt,
        expiresAt: row.expiresAt,
        marked: false,
        status: "in_stock",
        source: "invoice",
        // Полей quantity/unit в ShelfItem нет, поэтому количество и единицу (вместе
        // с ценой) дописываем в примечание читаемой строкой — «5 шт · 365,00 ₽».
        // Прежние части примечания не затираем: только добавляем через тот же разделитель.
        note: [
          measurementLine(row),
          `накладная: ${parsed.file.name}`,
          `${row.sheet}, строка ${row.sourceRow}`,
          notePart("код", row.code),
          notePart("сумма", row.amount),
          notePart("срок в накладной:", row.rawExpires),
        ]
          .filter(Boolean)
          .join(" · "),
        rawExpires: row.rawExpires,
      }));

      const { ids, skippedDuplicates, skipped } = await addItems(drafts);
      if (skippedDuplicates > 0) {
        const list = skipped
          .slice(0, 5)
          .map((item) => item.name)
          .join(", ");
        const rest = skippedDuplicates > 5 ? ` и ещё ${skippedDuplicates - 5}` : "";
        toast(`Добавлено ${ids.length} позиций · пропущено ${skippedDuplicates} (уже в наличии): ${list}${rest}`, "success", 8000);
      } else {
        toast(`Добавлено ${ids.length} позиций из накладной`, "success");
      }
      navigate("/");
    } catch (error) {
      toast(`Не удалось записать: ${String(error)}`, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Накладная поставщика"
        title="Загрузка накладной"
        action={
          <div className="flex gap-1.5">
            <Badge variant="outline">Excel</Badge>
            <Badge variant="outline">PDF</Badge>
          </div>
        }
      />

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void pick(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-5 py-9 text-center transition-colors",
          isDragging ? "border-accent bg-accent/10" : "border-input bg-card/60",
        )}
      >
        <div className="grid size-12 place-items-center rounded-lg bg-secondary text-accent">
          {busy && !parsed ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
        </div>

        <div className="space-y-1">
          <p className="text-lg font-semibold">Выберите файл накладной</p>
          <p className="text-sm text-muted-foreground">
            Excel (.xlsx, .xls, .xlsm) или текстовый PDF. Файл не покидает устройство.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          aria-label="Файл накладной"
          onChange={(event) => void pick(event.target.files?.[0])}
        />

        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Upload className="size-4" />
            Выбрать файл
          </Button>
          {file ? (
            <Button variant="outline" size="lg" onClick={clear} disabled={busy}>
              <RotateCcw className="size-4" />
              Другой файл
            </Button>
          ) : null}
        </div>
      </div>

      {file ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="grid size-10 place-items-center rounded-xl bg-secondary text-accent">
            {file.kind === "pdf" ? <FileText className="size-5" /> : <FileSpreadsheet className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {file.kind === "pdf" ? "PDF" : "Excel"} · {formatSize(file.size)}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Убрать файл" onClick={clear} disabled={busy}>
            <X className="size-4" />
          </Button>
        </div>
      ) : null}

      {parsed ? (
        <>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-base font-semibold">Что нашли в файле</p>
                <p className="text-xs text-muted-foreground">
                  {parsed.result.sheets.length > 1
                    ? `${parsed.result.sheets.length} ${sheetsWord(parsed.result.sheets.length)} · ` +
                      `всего ${parsed.result.rows.length} ${rowsWord(parsed.result.rows.length)}`
                    : `Лист «${parsed.result.sheet}» · заголовок в строке ${parsed.result.headerRow} · ` +
                      `${parsed.result.rows.length} ${rowsWord(parsed.result.rows.length)}`}
                </p>
              </div>
              <Badge variant="secondary">
                <CheckCircle2 className="size-3" /> разобрано
              </Badge>
            </div>

            <ParseTrust result={parsed.result} />

            {/* Приёмка накладной: кого и когда привезли. Оба поля заполняет
                человек — из файла берётся только подсказка. */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="invoice-supplier" className="block text-sm font-medium">
                  Поставщик <span className="text-destructive">*</span>
                </label>
                <div className="flex gap-2">
                  <Select
                    id="invoice-supplier"
                    className="min-w-0 flex-1"
                    value={chosenSupplierId}
                    onChange={(event) => setParsed({ ...parsed, supplierId: event.target.value })}
                  >
                    <option value="">— выберите поставщика —</option>
                    {supplierNamesForPicker.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setNewSupplierOpen(true)}
                    title="Завести нового поставщика в справочнике"
                  >
                    <UserPlus className="size-4" />
                    Создать нового
                  </Button>
                </div>
                <span className="block text-xs text-muted-foreground">
                  Из справочника — попадёт во вкладки и фильтры журнала.
                </span>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="invoice-received" className="block text-sm font-medium">
                  Дата поступления партии <span className="text-destructive">*</span>
                </label>
                <Input
                  id="invoice-received"
                  type="date"
                  required
                  aria-required="true"
                  aria-invalid={parsed.receivedAt ? undefined : true}
                  value={parsed.receivedAt}
                  onChange={(event) => setParsed({ ...parsed, receivedAt: event.target.value })}
                />
                <span className="block text-xs text-muted-foreground">
                  {fileDate && fileDate !== parsed.receivedAt ? (
                    <>
                      В накладной дата {formatRu(fileDate)} —{" "}
                      <button
                        type="button"
                        className="font-medium text-accent underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setParsed({ ...parsed, receivedAt: fileDate })}
                      >
                        подставить её
                      </button>
                      . По умолчанию стоит сегодня.
                    </>
                  ) : (
                    "Запишется в «Дату поступления» у всех строк накладной."
                  )}
                </span>
              </div>
            </div>

            {/* Что сказал файл: подсказка, а не применённое значение. */}
            {fileSupplierRaw ? (
              suggestedSupplier ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  В файле: «{fileSupplierPretty}» → подставлен{" "}
                  <strong>{suggestedSupplier.name}</strong> из справочника. Проверьте выбор — запишется
                  только по кнопке «Добавить в журнал».
                </p>
              ) : (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <p className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      В файле поставщик «{fileSupplierPretty}», но такой записи в справочнике нет.
                      Сама она не заведётся: выберите другого поставщика или создайте нового.
                    </span>
                  </p>
                  <button
                    type="button"
                    className="mt-1.5 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setNewSupplierOpen(true)}
                  >
                    Создать «{fileSupplierPretty}»
                  </button>
                </div>
              )
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="size-3.5" />
                В файле поставщика нет — выберите его вручную.
              </p>
            )}
          </div>

          {warnings.length > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {warnings.length} строк с предупреждениями. Проверьте даты и суммы в таблице ниже —
                при сомнении уберите галочку, и строка не попадёт в журнал.
              </span>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <p className="text-base font-semibold">Строки накладной</p>
              <span className="text-xs text-muted-foreground">
                к записи: {included.length} · исключено: {parsed.excluded.size}
              </span>
            </div>

            {/* Таблица шириной min-w-[52rem] на телефоне разводит галочку и «Годен до»
                по разным концам прокрутки, поэтому ниже md рисуем те же строки карточками. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[52rem] border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground">
                    <th className="w-10 border-b border-border px-2 py-2 font-medium">✓</th>
                    <th className="border-b border-border px-2 py-2 font-medium">№</th>
                    <th className="border-b border-border px-2 py-2 font-medium">Наименование</th>
                    <th className="border-b border-border px-2 py-2 font-medium">Код</th>
                    <th className="border-b border-border px-2 py-2 font-medium">Кол-во</th>
                    <th className="border-b border-border px-2 py-2 font-medium">Ед.</th>
                    <th className="border-b border-border px-2 py-2 font-medium">Цена</th>
                    <th className="border-b border-border px-2 py-2 font-medium">Сумма</th>
                    <th className="border-b border-border px-2 py-2 font-medium">Годен до</th>
                    <th className="border-b border-border px-2 py-2 font-medium">Примечание</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.result.rows.map((row) => (
                    <PreviewRow
                      key={rowKey(row)}
                      row={row}
                      showSheet={parsed.result.sheets.length > 1}
                      included={!parsed.excluded.has(rowKey(row))}
                      onToggle={() => toggleRow(rowKey(row))}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-border md:hidden">
              {parsed.result.rows.map((row) => (
                <PreviewCard
                  key={rowKey(row)}
                  row={row}
                  showSheet={parsed.result.sheets.length > 1}
                  included={!parsed.excluded.has(rowKey(row))}
                  onToggle={() => toggleRow(rowKey(row))}
                />
              ))}
            </ul>

            <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              {parsed.result.sheets.length > 1
                ? "Номер строки — из исходного листа; перед номером — лист книги или страница PDF."
                : `Номер строки — из исходного файла, строка ${parsed.result.headerRow} была заголовком.`}{" "}
              Реквизиты, итоги и подписи в таблицу не попали.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              Срок «годен до» распознаётся как дата; если в файле текст вроде «18.09..29», строка
              попадёт в группу «Без срока», а исходный текст сохранится в примечании.
            </span>
          </div>

          {/* На телефоне панель держим НАД нижним доком (его высота — 6.5rem,
              см. DockSpacer), иначе «Добавить в журнал» уезжает под док; на десктопе
              дока нет, и панель остаётся внизу у края.

              Сводка «что запишется» — здесь же: поставщик и дата поступления одни
              на всю накладную, и видеть их надо в момент нажатия. */}
          <div className="sticky bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-10 space-y-1.5 md:bottom-3">
            <p className="rounded-lg border border-border bg-card/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
              Запишется: {included.length} {rowsWord(included.length)} · поставщик{" "}
              <strong className={chosenSupplier ? "text-foreground" : "text-destructive"}>
                {chosenSupplier?.name ?? "не выбран"}
              </strong>{" "}
              · поступление{" "}
              <strong className={parsed.receivedAt ? "text-foreground" : "text-destructive"}>
                {parsed.receivedAt ? formatRu(parsed.receivedAt) : "не указано"}
              </strong>
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" size="lg" onClick={handleAdd} disabled={busy || included.length === 0}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {busy ? "Записываем…" : `Добавить в журнал (${included.length})`}
              </Button>
              <Button variant="outline" size="lg" onClick={clear} disabled={busy}>
                Отмена
              </Button>
            </div>
          </div>
        </>
      ) : file && !busy ? (
        <div className="rounded-xl border border-border bg-card/70 p-5">
          <p className="text-base font-semibold">Таблицу товаров не нашли</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Попробуйте файл, где есть колонки «Наименование» и «Кол-во» / «Цена» / «Сумма».
            Строки с ИНН, КПП и адресами намеренно игнорируются.
          </p>
        </div>
      ) : null}

      {!file ? (
        <div className="rounded-xl border border-border bg-card/70 p-5">
          <p className="text-base font-semibold">Что приложение сделает с накладной</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {[
              "Найдёт таблицу товаров ниже шапки с реквизитами",
              "Покажет все строки для проверки — ничего не запишется сразу",
              "Спросит поставщика и дату поступления: их выбирает человек",
              "Создаст позиции в журнале и перенесёт их на экран «Сроки»",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <FileText className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Нового поставщика заводит только человек и только отсюда: по строке из
          файла запись справочника больше не создаётся. */}
      <NewSupplierDialog
        open={newSupplierOpen}
        onClose={() => setNewSupplierOpen(false)}
        initialName={fileSupplierPretty}
        onCreated={(supplier) =>
          setParsed((current) => (current ? { ...current, supplierId: supplier.id } : current))
        }
      />
    </div>
  );
}

function PreviewRow({
  row,
  included,
  onToggle,
  showSheet,
}: {
  row: InvoiceRow;
  included: boolean;
  onToggle: () => void;
  showSheet: boolean;
}) {
  return (
    <tr className={cn(!included && "opacity-45", row.warning && "bg-amber-50")}>
      <td className="border-b border-border/60 px-2 py-2">
        <input
          type="checkbox"
          className="size-4 accent-[#1a1714]"
          aria-label={rowCheckboxLabel(row)}
          checked={included}
          onChange={onToggle}
        />
      </td>
      <td className="border-b border-border/60 px-2 py-2 text-muted-foreground">
        {showSheet ? `${row.sheet} · ${row.sourceRow}` : row.sourceRow}
      </td>
      <td className="border-b border-border/60 px-2 py-2 font-medium" title={row.name}>
        {shortName(row.name)}
      </td>
      <td className="border-b border-border/60 px-2 py-2 font-mono text-muted-foreground">{row.code || "—"}</td>
      <td className="border-b border-border/60 px-2 py-2 tabular-nums">{row.quantity || "—"}</td>
      <td className="border-b border-border/60 px-2 py-2">{row.unit || "—"}</td>
      <td className="border-b border-border/60 px-2 py-2 tabular-nums">{row.price || "—"}</td>
      <td className="border-b border-border/60 px-2 py-2 tabular-nums">{row.amount || "—"}</td>
      <td className="border-b border-border/60 px-2 py-2">
        <ExpiryValue row={row} />
      </td>
      <td className="border-b border-border/60 px-2 py-2">
        {row.warning ? (
          <span className="text-amber-700" title={row.warning}>
            <AlertTriangle className="size-3.5" />
          </span>
        ) : "—"}
      </td>
    </tr>
  );
}

/** «Годен до»: распознанная дата, иначе исходный текст — видно, что именно не разобралось. */
function ExpiryValue({ row, limit = 14 }: { row: InvoiceRow; limit?: number }) {
  if (row.expiresAt) return <>{formatRu(row.expiresAt)}</>;
  if (row.rawExpires) {
    return (
      <span className="text-amber-700" title={row.rawExpires}>
        {shortName(row.rawExpires, limit)}
      </span>
    );
  }
  return <>—</>;
}

/**
 * Карточка строки для телефона: в таблице галочка и «Годен до» оказывались на
 * противоположных концах горизонтальной прокрутки, и срок приходилось искать.
 */
function PreviewCard({
  row,
  included,
  onToggle,
  showSheet,
}: {
  row: InvoiceRow;
  included: boolean;
  onToggle: () => void;
  showSheet: boolean;
}) {
  const cells: Array<[string, string]> = [
    ["Код", cellText(row.code) || "—"],
    ["Кол-во", cellText(row.quantity) || "—"],
    ["Ед.", cellText(row.unit) || "—"],
    ["Цена", cellText(row.price) || "—"],
    ["Сумма", cellText(row.amount) || "—"],
  ];

  return (
    <li className={cn("space-y-2 px-3 py-3", !included && "opacity-45", row.warning && "bg-amber-50")}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 size-5 accent-[#1a1714]"
          aria-label={rowCheckboxLabel(row)}
          checked={included}
          onChange={onToggle}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{row.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {showSheet ? `${row.sheet} · ` : ""}строка {row.sourceRow}
          </p>
        </div>
        {/* Срок держим рядом с галочкой — это главное, что проверяют на складе. */}
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-muted-foreground">Годен до</p>
          <p className="text-sm font-semibold">
            <ExpiryValue row={row} limit={18} />
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {row.warning ? (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {row.warning}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Честная сводка разбора: уверенность, номера пропущенных строк и разбивка по
 * листам. Без неё «разобрано» выглядит одинаково и когда поняли весь файл,
 * и когда выбросили половину строк.
 */
function ParseTrust({ result }: { result: InvoiceParseResult }) {
  // confidence приходит из разбора и может быть битым — лучше «0%», чем «NaN%».
  const rawConfidence = Number.isFinite(result.confidence) ? result.confidence : 0;
  const confidence = Math.round(Math.min(1, Math.max(0, rawConfidence)) * 100);
  const low = confidence < LOW_CONFIDENCE;

  const skipped = result.skipped ?? [];
  const shownSkipped = skipped.slice(0, SKIPPED_PREVIEW);
  const restSkipped = skipped.length - shownSkipped.length;

  return (
    <div className="mt-3 space-y-1.5 rounded-lg bg-secondary/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn("inline-flex items-center gap-1 font-medium", low ? "text-amber-700" : "text-muted-foreground")}
          title="Насколько уверенно разбор нашёл таблицу товаров и распознал колонки"
        >
          {low ? <AlertTriangle className="size-3.5" /> : <Info className="size-3.5" />}
          уверенность разбора: {confidence}%
          {low ? " — проверьте колонки внимательно" : ""}
        </span>

        {/* Ноль пропущенных ничего не объясняет — тогда этой строки нет вовсе. */}
        {skipped.length > 0 ? (
          <span
            className="text-muted-foreground"
            title="Шапка, реквизиты, итоги и пустые строки — в журнал они не попадают"
          >
            пропущено {skipped.length} {rowsWord(skipped.length)}: {shownSkipped.join(", ")}
            {restSkipped > 0 ? ` и ещё ${restSkipped}` : ""}
          </span>
        ) : null}
      </div>

      {/* Разбивка по листам нужна только когда листов правда несколько. */}
      {result.sheets.length > 1 ? (
        <ul className="space-y-0.5">
          {result.sheets.map((part, index) => (
            <li
              key={`${part.sheet}-${index}`}
              className="flex flex-wrap items-center gap-x-2 text-muted-foreground"
            >
              <span className="font-medium text-foreground">«{part.sheet}»</span>
              <span>
                {part.rowCount} {rowsWord(part.rowCount)}
              </span>
              {part.skipped > 0 ? <span>· пропущено {part.skipped}</span> : null}
              {part.continuation ? (
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                  продолжение предыдущего листа
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
