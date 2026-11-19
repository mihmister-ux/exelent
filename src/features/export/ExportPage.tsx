import { useEffect, useMemo, useRef, useState } from "react";
import { DatabaseBackup, Download, Info, Upload } from "lucide-react";
import { useLocation } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { backupFilename, createBackup, downloadFile, restoreBackup } from "@/db/backup";
import { listSuppliers } from "@/db/suppliers";
import { reseedFromJson } from "@/db/seed";
import { journalFilename, journalWorkbook, workbookBytes } from "@/domain/export-xlsx";
import { summarize } from "@/domain/groups";
import { supplierOptions } from "@/domain/filter";
import type { Supplier } from "@/db/types";
import { useShelfItems, useToday } from "@/features/shelf/useShelf";

/** Колонки исходного журнала — выгрузка должна повторить их 1:1. */
const COLUMNS = [
  { letter: "A", title: "п/н", auto: true },
  { letter: "B", title: "Наименование товара", auto: false },
  { letter: "C", title: "Дата поступления", auto: false },
  { letter: "D", title: "Годен до", auto: false },
  { letter: "E", title: "Остаток на конец месяца", auto: true },
  { letter: "F", title: "Истёк срок годности", auto: true },
  { letter: "G", title: "Выбыл", auto: false },
  { letter: "H", title: "Честный знак", auto: false },
  { letter: "I", title: "Дата акта на списании", auto: true },
];

export default function ExportPage() {
  const items = useShelfItems();
  const on = useToday();
  const { hash } = useLocation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLDivElement>(null);

  const all = items ?? [];
  const summary = summarize(all, on);
  // Листы книги — по «чистым» поставщикам из справочника, а не по числу
  // «сырых» написаний в позициях.
  const supplierSheets = useMemo(() => supplierOptions(all, suppliers), [all, suppliers]);

  // Справочник нужен выгрузке: он задаёт порядок листов и их имена. Ошибку
  // чтения не показываем — без справочника книга всё равно соберётся.
  useEffect(() => {
    let cancelled = false;
    listSuppliers()
      .then((rows) => {
        if (!cancelled) setSuppliers(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Переход из «Ещё» → «Резервная копия» идёт по адресу /export#backup — это
  // сработает и из своей шторки, и с любого экрана. После загрузки страницы
  // прокручиваем к блоку копии. Классических якорей в HashRouter нет (хеш уже
  // занят маршрутом), поэтому якорь читаем сами.
  useEffect(() => {
    if (hash !== "#backup") return;
    const target = backupRef.current;
    if (!target) return;
    // Даём ленивой загрузке страницы и разводке закончиться, иначе скролл
    // промахнётся мимо блока, который ещё не занял своё место.
    const timer = window.setTimeout(() => {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [hash]);

  /**
   * Скачать журнал в .xlsx.
   *
   * Файл собирается здесь, в браузере: ни запроса, ни сервера — журнал
   * остаётся на устройстве. Ошибку сборки показываем, а не глотаем:
   * пустой «Скачать» без объяснений — худший вариант.
   */
  const handleDownload = () => {
    if (building) return;
    setBuilding(true);
    try {
      const book = journalWorkbook(all, { on, suppliers });
      const bytes = workbookBytes(book);
      downloadFile(
        bytes,
        journalFilename(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      toast(
        `Файл сохранён: ${book.SheetNames.length} листов, ${all.length} строк`,
        "success",
        5000,
      );
    } catch (error) {
      toast(`Не удалось собрать .xlsx: ${String(error)}`, "danger");
    } finally {
      setBuilding(false);
    }
  };

  const handleReseed = async () => {
    setBusy(true);
    try {
      // Перечитывание заменяет импортированные позиции свежими 146 строками —
      // правки, внесённые в них вручную, иначе исчезли бы без следа. Перед
      // заменой сохраняем копию текущего журнала: она ляжет в «Загрузки», и
      // откат делается обычным «Восстановить из копии». Если копию сохранить
      // не вышло — перечитывание НЕ выполняем: молча терять данные нельзя.
      const backup = await createBackup();
      downloadFile(JSON.stringify(backup, null, 2), backupFilename());
      // Метка для «строки доверия» на главном экране: когда была последняя копия.
      localStorage.setItem("shelf:lastBackupAt", backup.exportedAt);

      const count = await reseedFromJson();
      toast(
        `Копия сохранена · перечитано ${count} строк из data/shelf-data.json`,
        "success",
        6000,
      );
      setConfirmOpen(false);
    } catch (error) {
      toast(`Не удалось: ${String(error)}`, "danger");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBackup = async () => {
    setBusy(true);
    try {
      const backup = await createBackup();
      downloadFile(JSON.stringify(backup, null, 2), backupFilename());
      localStorage.setItem("shelf:lastBackupAt", backup.exportedAt);
      toast(`Копия сохранена: ${backup.items.length} позиций, ${backup.suppliers.length} поставщиков`, "success");
    } catch (error) {
      toast(`Не удалось сохранить копию: ${String(error)}`, "danger");
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const { items: restoredItems, suppliers: restoredSuppliers } = await restoreBackup(text);
      toast(`Восстановлено: ${restoredItems} позиций, ${restoredSuppliers} поставщиков`, "success");
      setRestoreOpen(false);
      // Возвращаем адрес к «Резервной копии», если пришли по якорю:
      // иначе после закрытия диалога подсветка в «Ещё» погаснет.
      if (window.location.hash.endsWith("#backup")) window.location.hash = "#/export#backup";
    } catch (error) {
      toast(`Не удалось восстановить: ${String(error)}`, "danger");
    } finally {
      setBusy(false);
    }
  };

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Печать и архив"
        title="Выгрузить в Excel"
        action={<Badge variant="outline">этап 3</Badge>}
      />

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="text-sm">
          Журнал выгружается в том же виде, что и раньше: те же 9 колонок и отдельный лист на
          каждого поставщика. Excel остаётся для печати и архива — источником истины остаётся
          приложение.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[22rem] border-collapse text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="border-b border-border py-1.5 pr-2 font-medium">Кол.</th>
                <th className="border-b border-border py-1.5 pr-2 font-medium">Название</th>
                <th className="border-b border-border py-1.5 font-medium">Кто заполняет</th>
              </tr>
            </thead>
            <tbody>
              {COLUMNS.map((column) => (
                <tr key={column.letter}>
                  <td className="border-b border-border/60 py-1.5 pr-2 font-mono">{column.letter}</td>
                  <td className="border-b border-border/60 py-1.5 pr-2">{column.title}</td>
                  <td className="border-b border-border/60 py-1.5 text-muted-foreground">
                    {column.auto ? "приложение" : "приложение (из данных)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Сейчас в журнале {summary.total} позиций: {summary.total - summary.writtenOff} в наличии,{" "}
          {summary.writtenOff} выбыло, {summary.noDate} без срока. Листов в книге: {supplierSheets.length}.
        </p>

        <Button className="mt-4 w-full" size="lg" onClick={handleDownload} disabled={building}>
          <Download className="size-4" />
          {building ? "Собираем файл…" : "Скачать .xlsx"}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Файл собирается на этом устройстве и никуда не отправляется.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <span>
          Исходный файл «Учёт сроков хранения.xlsm» приложение не перезаписывает никогда:
          выгрузка создаёт новый файл рядом.
        </span>
      </div>

      <div ref={backupRef} className="rounded-xl border border-border bg-card p-4 shadow-sm scroll-mt-4">
        <p className="text-base font-semibold">Резервная копия</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Журнал хранится только на этом устройстве. Сохраните копию, чтобы перенести его на
          другой телефон или восстановить после очистки данных браузера.
        </p>

        <div className="mt-3 grid gap-2">
          <Button onClick={handleSaveBackup} disabled={busy}>
            <Download className="size-4" />
            Сохранить копию (.json)
          </Button>
          <Button variant="outline" onClick={() => setRestoreOpen(true)} disabled={busy}>
            <Upload className="size-4" />
            Восстановить из копии
          </Button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Восстановление заменяет весь журнал данными из файла.
        </p>
      </div>

      {/* Перечитывание демо-журнала — инструмент разработки. В публичной
          сборке демо-строк нет, и кнопка вела бы к ошибке. */}
      {import.meta.env.DEV && (
        <div className="rounded-xl border border-border bg-card/70 p-4">
          <p className="text-base font-semibold">Данные журнала</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Если журнал пересобрали на этапе 1, можно перечитать те же 146 строк. Ручные позиции и
            строки из накладных при этом сохраняются.
          </p>
          <Button variant="outline" className="mt-3" onClick={() => setConfirmOpen(true)}>
            <DatabaseBackup className="size-4" />
            Перечитать data/shelf-data.json
          </Button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleRestoreFile(file);
          event.target.value = "";
        }}
      />

      <Dialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title="Восстановить из копии?"
        description="Текущий журнал будет полностью заменён данными из файла. Сделайте свежую копию, если сомневаетесь."
      >
        <div className="flex gap-2">
          <Button className="flex-1" onClick={handlePickFile} disabled={busy}>
            {busy ? "Читаем…" : "Выбрать файл"}
          </Button>
          <Button variant="outline" onClick={() => setRestoreOpen(false)} disabled={busy}>
            Отмена
          </Button>
        </div>
      </Dialog>

      {/* Диалог перечитывания — тоже только для разработки: в публичной
          сборке кнопки, которая его открывает, нет. */}
      {import.meta.env.DEV && (
        <Dialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Перечитать журнал из JSON?"
          description="Позиции из Excel будут заменены свежими данными файла. Перед заменой автоматически сохранится копия текущего журнала — ею можно будет восстановить правки. Всё, что добавлено вручную или из накладных, останется."
        >
          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleReseed} disabled={busy}>
              {busy ? "Читаем…" : "Перечитать"}
            </Button>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Отмена
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
