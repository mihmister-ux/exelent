import { Ban, Check, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SupplierBadge } from "@/components/ui/supplier-badge";
import { toast } from "@/components/ui/toast";
import type { ShelfItem } from "@/db/types";
import { markSold, markWrittenOff, removeItem, returnToStock } from "@/db/repo";
import type { ExpiryInfo } from "@/domain/expiry";
import { EXPIRY_STYLE } from "@/domain/expiry";
import { receivedLabel } from "@/domain/received";
import { formatRu } from "@/lib/dates";
import { cn, errorText } from "@/lib/utils";

export interface ItemCardProps {
  item: ShelfItem;
  expiry: ExpiryInfo;
  onEdit: (item: ShelfItem) => void;
}

/**
 * Позиция журнала: белая карточка с чёткой границей, слева — полоса цвета
 * статуса (те же цвета, что красили строки в Excel), рядом плашка поставщика
 * с фирменным цветом и названием.
 */
export function ItemCard({ item, expiry, onEdit }: ItemCardProps) {
  const style = EXPIRY_STYLE[expiry.kind];
  const received = receivedLabel(item.receivedAt);
  /** Даты нет — пишем это бледным курсивом, чтобы не путать с настоящей датой. */
  const receivedMissing = received === "Поступление не указано";

  /**
   * «Продан» и «Списать» — одно касание, поэтому в уведомлении есть отмена:
   * на телефоне в перчатке промахнуться мимо соседней кнопки легко, а
   * заметить промах — только по исчезнувшей из списка позиции.
   */
  const handleSold = async () => {
    try {
      await markSold(item.id);
      toast(`«${shortName(item.name)}» продан · позиция в архиве`, "success", 7000, {
        label: "Отменить",
        onClick: () => returnToStock(item.id),
      });
    } catch (error) {
      toast(`Не удалось отметить «${shortName(item.name)}»: ${errorText(error)}`, "danger");
    }
  };

  const handleWriteOff = async () => {
    try {
      await markWrittenOff(item.id);
      toast(`«${shortName(item.name)}» списан · позиция в архиве`, "success", 7000, {
        label: "Отменить",
        onClick: () => returnToStock(item.id),
      });
    } catch (error) {
      toast(`Не удалось списать «${shortName(item.name)}»: ${errorText(error)}`, "danger");
    }
  };

  /**
   * Удаление — единственное действие, которое стирает запись целиком,
   * поэтому спрашиваем подтверждение. «Продан» и «Списать» только меняют
   * статус и оставляют позицию в архиве, их путать с удалением нельзя.
   */
  const handleDelete = async () => {
    const confirmed = window.confirm(`Удалить товар?\n\n«${item.name}»`);
    if (!confirmed) return;

    try {
      await removeItem(item.id);
      toast(`«${shortName(item.name)}» удалён из журнала`, "success");
    } catch (error) {
      toast(`Не удалось удалить «${shortName(item.name)}»: ${errorText(error)}`, "danger");
    }
  };

  return (
    <article className="animate-reveal flex overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <span aria-hidden className="w-1.5 shrink-0" style={{ backgroundColor: style.stripe }} />

      <div className={cn("flex flex-1 flex-col gap-2 p-3", style.tint)}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug">{item.name}</p>
          <span
            className={cn(
              "shrink-0 rounded px-2 py-1 text-[11px] font-semibold leading-none whitespace-nowrap",
              style.chip,
            )}
          >
            {expiry.headline}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Цвет — для быстрого сканирования, название — чтобы не запоминать. */}
          <SupplierBadge supplier={item.supplier} />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            до {formatRu(item.expiresAt)}
          </span>
          {/*
            Дата поступления — рядом со сроком, а не в отдельной секции: именно
            эти две даты отличают две партии одного товара друг от друга.
          */}
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              receivedMissing ? "text-muted-foreground/70 italic" : "text-muted-foreground",
            )}
          >
            {received}
          </span>
          {item.rawExpires ? <Badge variant="outline">в журнале: {item.rawExpires}</Badge> : null}
          {item.marked ? <Badge variant="outline">Честный знак</Badge> : null}
          {item.excelRow ? (
            <span className="text-[11px] text-muted-foreground">Excel: строка {item.excelRow}</span>
          ) : null}

          {/*
            Действия — иконки справа. Размер 44×44 (size-11) и зазор 6 px:
            это минимальная цель для пальца по рекомендациям Apple/Google,
            на 36 px в перчатке промахивались мимо соседней кнопки.
          */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {expiry.kind === "expired" ? (
              <Button
                variant="outline"
                size="icon"
                className="size-11"
                title="Списать"
                aria-label={`Списать: ${item.name}`}
                onClick={handleWriteOff}
              >
                <Ban className="size-5" />
              </Button>
            ) : null}

            <Button
              variant="outline"
              size="icon"
              className="size-11"
              title="Отметить проданным"
              aria-label={`Продано: ${item.name}`}
              onClick={handleSold}
            >
              <Check className="size-5" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="size-11"
              title="Изменить"
              aria-label={`Изменить: ${item.name}`}
              onClick={() => onEdit(item)}
            >
              <Pencil className="size-5" />
            </Button>

            {/* Корзина: красная рамка отделяет необратимое удаление от «Продано». */}
            <Button
              variant="outline"
              size="icon"
              className="size-11 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title="Удалить"
              aria-label={`Удалить: ${item.name}`}
              onClick={handleDelete}
            >
              <Trash2 className="size-5" />
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Длинные названия из накладных не влезают в уведомление целиком. */
function shortName(name: string): string {
  return name.length > 34 ? `${name.slice(0, 33)}…` : name;
}
