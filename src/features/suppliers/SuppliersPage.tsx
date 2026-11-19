import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, Combine, Eraser, Pencil, Plus, Trash2, TriangleAlert, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { db } from "@/db/db";
import {
  addSupplier,
  archiveSupplier,
  cleanSupplierNames,
  deleteSupplier,
  mergeSuppliers,
  putSupplier,
  type CleanResult,
} from "@/db/suppliers";
import { isInStock, type Supplier } from "@/db/types";
import {
  findSimilarSuppliers,
  mergeCandidates,
  nextSupplierColor,
  nextSupplierOrder,
} from "@/domain/suppliers";
import { cleanSupplierName, hasSupplierNoise } from "@/domain/supplier-name";
import { errorText, plural } from "@/lib/utils";
import { SupplierDeleteDialog } from "./SupplierDeleteDialog";
import { SupplierEditor } from "./SupplierEditor";

/**
 * Справочник поставщиков: объединение дублей и архивация пустых.
 *
 * Задвоение появлялось так: в Excel поставщик был листом («ГРИНФИТО ООО»),
 * а в накладной тот же поставщик приходил другим написанием («Гринфито»).
 * Справочник считал их разными записями, и в выпадающем списке оказывались
 * оба варианта. Объединение переносит позиции на одну запись, а старую
 * прячет в архив — история при этом остаётся целой.
 */

interface Row {
  supplier: Supplier;
  inStock: number;
  total: number;
}

export default function SuppliersPage() {
  const directory = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const items = useLiveQuery(() => db.items.toArray(), [], []);

  const [mergeOpen, setMergeOpen] = useState(false);
  const [oldId, setOldId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [showAllTargets, setShowAllTargets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);

  // Правка справочника: `editorId === "new"` — добавление, иначе id записи.
  const [editorId, setEditorId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const counts = new Map<string, { inStock: number; total: number }>();
    const bump = (name: string, inStock: boolean) => {
      const current = counts.get(name) ?? { inStock: 0, total: 0 };
      counts.set(name, {
        inStock: current.inStock + (inStock ? 1 : 0),
        total: current.total + 1,
      });
    };

    for (const item of items) bump(item.supplier, isInStock(item));

    return directory
      .slice()
      .sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.name.localeCompare(b.name, "ru"))
      .map((supplier) => {
        // Позиции помнят «сырое» написание, поэтому складываем по имени и алиасам.
        const keys = new Set([supplier.name, ...supplier.aliases]);
        let inStock = 0;
        let total = 0;
        for (const key of keys) {
          const found = counts.get(key);
          if (found) {
            inStock += found.inStock;
            total += found.total;
          }
        }
        return { supplier, inStock, total };
      });
  }, [directory, items]);

  const active = rows.filter((row) => !row.supplier.hidden);
  const archived = rows.filter((row) => row.supplier.hidden);
  const suggestions = useMemo(() => findSimilarSuppliers(directory), [directory]);

  const oldSupplier = active.find((row) => row.supplier.id === oldId)?.supplier;
  const targetSupplier = active.find((row) => row.supplier.id === targetId)?.supplier;
  const canMerge = Boolean(oldSupplier && targetSupplier && oldId !== targetId);

  /*
    «Новый поставщик» показывает только похожих на выбранного «Старого»:
    сравниваем по первым 3–4 значимым словам без «ООО»/«ПКФ». Если похожих
    нет — об этом говорим прямо, а «Показать всех» открывает полный список
    для ручного выбора.
  */
  const targetOptions = useMemo(() => {
    const rows = active.filter((row) => row.supplier.id !== oldId);
    if (!oldId || showAllTargets) return rows.map((row) => ({ row, note: "" }));

    const { exact, similar } = mergeCandidates(directory, oldId);
    const similarIds = new Set(similar.map((supplier) => supplier.id));
    const exactIds = new Set(exact.map((supplier) => supplier.id));

    return rows
      .filter((row) => exactIds.has(row.supplier.id) || similarIds.has(row.supplier.id))
      .map((row) => ({
        row,
        note: exactIds.has(row.supplier.id) ? "тот же поставщик" : "похожее название",
      }));
  }, [active, directory, oldId, showAllTargets]);

  function openMerge(from?: string, to?: string) {
    setOldId(from ?? "");
    setTargetId(to ?? "");
    setShowAllTargets(false);
    setMergeOpen(true);
  }

  // Сменили «Старого» — прежний «Новый» мог выпасть из отфильтрованного списка.
  function changeOld(id: string) {
    setOldId(id);
    setShowAllTargets(false);
    if (targetId && targetId !== id) {
      const stillFits = !id || mergeCandidates(directory, id).exact.some((s) => s.id === targetId)
        || mergeCandidates(directory, id).similar.some((s) => s.id === targetId);
      if (!stillFits) setTargetId("");
    }
  }

  async function confirmMerge() {
    if (!oldSupplier || !targetSupplier) return;
    setBusy(true);
    try {
      await mergeSuppliers(oldSupplier.id, targetSupplier.id);
      toast(`«${oldSupplier.name}» объединён с «${targetSupplier.name}»`, "success");
      setMergeOpen(false);
      setOldId("");
      setTargetId("");
    } catch (cause) {
      toast(errorText(cause), "danger");
    } finally {
      setBusy(false);
    }
  }

  // Записи, которые очистка изменит: их и показываем до нажатия кнопки.
  const dirty = useMemo(
    () =>
      active
        .map((row) => {
          const clean = cleanSupplierName(row.supplier.name) || row.supplier.name;
          return { row, clean, noise: hasSupplierNoise(row.supplier.name) };
        })
        .filter((entry) => entry.noise || entry.clean !== entry.row.supplier.name),
    [active],
  );

  async function onClean() {
    setBusy(true);
    try {
      const result: CleanResult = await cleanSupplierNames();
      setCleanResult(result);
    } catch (cause) {
      toast(errorText(cause), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(row: Row) {
    if (row.inStock > 0) {
      toast(
        "У этого поставщика есть товары в наличии. Сначала объедините его с другим или распродайте товар",
        "danger",
        6000,
      );
      return;
    }
    try {
      await archiveSupplier(row.supplier.id);
      toast(`«${row.supplier.name}» в архиве`, "success");
    } catch (cause) {
      toast(errorText(cause), "danger");
    }
  }

  /**
   * Сохранение из диалога: одна и та же функция добавляет и правит.
   * Для новой записи цвет и порядок берём из палитры — так новая вкладка
   * не сливается с соседней по цвету.
   */
  async function onSaveSupplier(draft: { name: string; color: string }) {
    try {
      if (editorId === "new") {
        const created = await addSupplier({
          name: draft.name,
          color: draft.color,
          aliases: [],
          hidden: false,
          order: nextSupplierOrder(directory),
        });
        toast(`«${created.name}» добавлен`, "success");
        return;
      }
      if (!editorId) return;
      const existing = directory.find((supplier) => supplier.id === editorId);
      if (!existing) return;
      await putSupplier({ ...existing, name: draft.name, color: draft.color });
      toast(
        existing.name === draft.name
          ? `«${draft.name}» сохранён`
          : `«${existing.name}» переименован в «${draft.name}»`,
        "success",
      );
    } catch (cause) {
      toast(errorText(cause), "danger");
    }
  }

  async function onConfirmDelete(targetId: string | null) {
    if (!deleteTarget) return;
    const row = rows.find((entry) => entry.supplier.id === deleteTarget);
    if (!row) return;
    try {
      const result = await deleteSupplier(deleteTarget, targetId);
      toast(
        result.targetName
          ? `«${row.supplier.name}» удалён, ${result.moved} ${plural(result.moved, "товар", "товара", "товаров")} у «${result.targetName}»`
          : `«${row.supplier.name}» удалён`,
        "success",
      );
    } catch (cause) {
      toast(errorText(cause), "danger");
    }
  }

  const editorSupplier = editorId && editorId !== "new"
    ? directory.find((supplier) => supplier.id === editorId) ?? null
    : null;

  const deleting = deleteTarget
    ? rows.find((row) => row.supplier.id === deleteTarget) ?? null
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Справочник"
        title="Поставщики"
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setEditorId("new")}>
              <Plus className="size-4" />
              Добавить поставщика
            </Button>
            <Button size="sm" variant="outline" onClick={() => openMerge()}>
              <Combine className="size-4" />
              Объединить
            </Button>
          </div>
        }
      />

      <p className="rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
        Тот же поставщик в Excel и в накладной может называться по-разному — так в списке
        появляются двойники. «Объединить» переносит все товары (включая проданные и просроченные)
        к одному поставщику, а старую запись архивирует: история остаётся, список становится чище.
      </p>

      {dirty.length > 0 ? (
        <section
          aria-label="Грязные имена поставщиков"
          className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Eraser className="size-4 shrink-0 text-amber-800" />
            <p className="min-w-0 flex-1 text-sm text-amber-900">
              <strong>{dirty.length}</strong> {plural(dirty.length, "запись", "записи", "записей")}{" "}
              с лишним в названии: «ООО», ИНН, адреса, кавычки.
            </p>
            <Button size="sm" onClick={() => setCleanOpen(true)} disabled={busy}>
              Очистить имена поставщиков
            </Button>
          </div>
          <ul className="space-y-1 text-xs text-amber-900">
            {dirty.slice(0, 4).map((entry) => (
              <li key={entry.row.supplier.id} className="truncate">
                «{entry.row.supplier.name}» → «{entry.clean}»
              </li>
            ))}
            {dirty.length > 4 ? <li>…и ещё {dirty.length - 4}</li> : null}
          </ul>
        </section>
      ) : null}

      {suggestions.length > 0 ? (
        <section aria-label="Возможно, дубли" className="space-y-2">
          <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
            <TriangleAlert className="size-4 text-expired" />
            Похоже, это один и тот же поставщик
          </h2>
          {suggestions.map((suggestion) => (
            <div
              key={`${suggestion.a.id}-${suggestion.b.id}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-expired/20 bg-expired/5 px-3 py-2.5 text-sm"
            >
              <span className="font-medium">{suggestion.a.name}</span>
              <span aria-hidden className="text-muted-foreground">+</span>
              <span className="font-medium">{suggestion.b.name}</span>
              <span className="text-xs text-muted-foreground">— {suggestion.reason}</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => openMerge(suggestion.b.id, suggestion.a.id)}
              >
                Объединить
              </Button>
            </div>
          ))}
        </section>
      ) : null}

      {active.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Поставщиков нет"
          description="Они появятся из накладных и первого импорта журнала."
        />
      ) : (
        <ul className="space-y-2">
          {active.map((row) => (
            <li
              key={row.supplier.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-sm"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.supplier.color }}
              />
              <span className="min-w-0 flex-1 truncate font-medium" title={row.supplier.name}>
                {row.supplier.name}
              </span>

              <Badge variant="secondary">{row.inStock} в наличии</Badge>
              <Badge variant="outline">всего {row.total}</Badge>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => openMerge(row.supplier.id, targetId)}
                aria-label={`Объединить ${row.supplier.name}`}
              >
                <Combine className="size-4" />
                Объединить
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditorId(row.supplier.id)}
                title="Изменить название и цвет"
                aria-label={`Редактировать ${row.supplier.name}`}
              >
                <Pencil className="size-4" />
                <span className="sr-only">Редактировать</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onArchive(row)}
                disabled={row.inStock > 0}
                title={
                  row.inStock > 0
                    ? "У этого поставщика есть товары в наличии — доступно только объединение"
                    : "Архивировать поставщика"
                }
                aria-label={`Архивировать ${row.supplier.name}`}
              >
                <Archive className="size-4" />
                <span className="sr-only">Архивировать</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteTarget(row.supplier.id)}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                title="Удалить поставщика"
                aria-label={`Удалить ${row.supplier.name}`}
              >
                <Trash2 className="size-4" />
                <span className="sr-only">Удалить</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <section aria-label="Архив поставщиков" className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">
            Архив ({archived.length})
          </h2>
          <ul className="space-y-1.5">
            {archived.map((row) => (
              <li
                key={row.supplier.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-input bg-secondary/40 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {row.supplier.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  товаров: {row.total}
                </span>
              </li>
            ))}
          </ul>
          <p className="px-1 text-xs text-muted-foreground">
            Архивные записи не появляются в фильтрах, но товары и история под ними сохранены.
          </p>
        </section>
      ) : null}

      <Dialog
        open={mergeOpen}
        onClose={() => (busy ? undefined : setMergeOpen(false))}
        title="Объединение поставщиков"
        description="Товары переедут к новому поставщику, старая запись уйдёт в архив."
      >
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Старый поставщик</span>
            <Select
              value={oldId}
              onChange={(event) => changeOld(event.target.value)}
              aria-label="Старый поставщик"
            >
              <option value="">Выберите…</option>
              {active
                .filter((row) => row.supplier.id !== targetId)
                .map((row) => (
                  <option key={row.supplier.id} value={row.supplier.id}>
                    {row.supplier.name} ({row.total})
                  </option>
                ))}
            </Select>
          </label>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="merge-target" className="block text-sm font-medium">
                Новый поставщик
              </label>
              {showAllTargets || !oldId ? null : (
                <button
                  type="button"
                  onClick={() => setShowAllTargets(true)}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Показать всех
                </button>
              )}
            </div>

            {targetOptions.length > 0 ? (
              <Select
                id="merge-target"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                aria-label="Новый поставщик"
              >
                <option value="">Выберите…</option>
                {targetOptions.map(({ row, note }) => (
                  <option key={row.supplier.id} value={row.supplier.id}>
                    {row.supplier.name} ({row.total}){note ? ` — ${note}` : ""}
                  </option>
                ))}
              </Select>
            ) : (
              /*
                Похожих нет — честно говорим об этом и оставляем выход: «Показать
                всех». Пустой выпадающий список человек читал бы как ошибку.
              */
              <div
                role="status"
                className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
              >
                <p>Похожих поставщиков не найдено. Вы уверены, что хотите объединить с другим?</p>
                <button
                  type="button"
                  onClick={() => setShowAllTargets(true)}
                  className="text-xs font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Показать всех
                </button>
              </div>
            )}
          </div>

          {canMerge ? (
            <div
              role="alert"
              className="rounded-lg border border-expired/30 bg-expired/5 px-3 py-2.5 text-sm"
            >
              Вы объединяете{" "}
              <strong>{oldSupplier?.name}</strong> и{" "}
              <strong>{targetSupplier?.name}</strong>. Все товары (включая проданные и
              просроченные) будут перенесены к{" "}
              <strong>{targetSupplier?.name}</strong>. Старый поставщик будет архивирован.
              Вы уверены?
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Выберите двух разных поставщиков, чтобы увидеть, что именно произойдёт.
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setMergeOpen(false)}
              disabled={busy}
            >
              Нет
            </Button>
            <Button className="flex-1" onClick={() => void confirmMerge()} disabled={!canMerge || busy}>
              {busy ? "Объединяем…" : "Да, объединить"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Подтверждение очистки: до нажатия показываем, что именно изменится. */}
      <Dialog
        open={cleanOpen && !cleanResult}
        onClose={() => (busy ? undefined : setCleanOpen(false))}
        title="Очистить имена поставщиков"
        description="Из названий уберутся «ООО» и «ПКФ», ИНН, КПП, адреса, телефоны и кавычки. Двойники объединятся в одного поставщика."
      >
        <div className="space-y-3">
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border bg-secondary/40 p-3 text-sm">
            {dirty.map((entry) => (
              <li key={entry.row.supplier.id} className="truncate">
                <span className="text-muted-foreground line-through">{entry.row.supplier.name}</span>
                {" → "}
                <strong>{entry.clean}</strong>
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">
            Товары не удаляются: у каждой позиции просто сменится написание поставщика. Записи,
            которые станут двойниками, уйдут в архив — их можно вернуть вручную.
          </p>

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setCleanOpen(false)}
              disabled={busy}
            >
              Отмена
            </Button>
            <Button className="flex-1" onClick={() => void onClean()} disabled={busy}>
              {busy ? "Очищаем…" : "Да, очистить"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Результат: сколько было и сколько стало — прямо цифрами. */}
      <Dialog
        open={Boolean(cleanResult)}
        onClose={() => {
          setCleanResult(null);
          setCleanOpen(false);
        }}
        title="Имена очищены"
      >
        {cleanResult ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-border bg-secondary/40 px-3 py-3">
                <p className="text-2xl font-semibold tabular-nums">{cleanResult.before}</p>
                <p className="text-xs text-muted-foreground">поставщиков было</p>
              </div>
              <div className="rounded-lg border border-border bg-secondary/40 px-3 py-3">
                <p className="text-2xl font-semibold tabular-nums">{cleanResult.after}</p>
                <p className="text-xs text-muted-foreground">стало</p>
              </div>
            </div>

            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                Переименовано: <strong className="text-foreground">{cleanResult.renamed}</strong>
              </li>
              <li>
                Товаров с новым написанием:{" "}
                <strong className="text-foreground">{cleanResult.itemsTouched}</strong>
              </li>
              {cleanResult.merged.length > 0 ? (
                <li>
                  Объединено двойников:{" "}
                  <strong className="text-foreground">{cleanResult.merged.length}</strong>
                </li>
              ) : null}
            </ul>

            {cleanResult.merged.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-secondary/40 p-3 text-xs">
                {cleanResult.merged.map((entry) => (
                  <li key={`${entry.from}-${entry.into}`} className="truncate">
                    «{entry.from}» → «{entry.into}»
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Если что-то пошло не так, есть резервная копия: «Товары» → «Копия базы».
            </p>

            <Button
              className="w-full"
              onClick={() => {
                setCleanResult(null);
                setCleanOpen(false);
              }}
            >
              Понятно
            </Button>
          </div>
        ) : null}
      </Dialog>
      <SupplierEditor
        open={editorId !== null}
        onClose={() => setEditorId(null)}
        directory={directory}
        supplier={editorSupplier}
        suggestedColor={nextSupplierColor(directory)}
        onSave={onSaveSupplier}
      />

      <SupplierDeleteDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        supplier={deleting?.supplier ?? null}
        count={deleting?.total ?? 0}
        targets={active
          .filter((row) => row.supplier.id !== deleteTarget)
          .map((row) => row.supplier)}
        onConfirm={onConfirmDelete}
        onArchive={async () => {
          if (!deleting) return;
          try {
            await archiveSupplier(deleting.supplier.id);
            toast(`«${deleting.supplier.name}» в архиве`, "success");
          } catch (cause) {
            toast(errorText(cause), "danger");
          }
        }}
      />
    </div>
  );
}
