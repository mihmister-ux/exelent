import { formatRu, parseISODate, pluralDays } from "@/lib/dates";
import { daysBetween, startOfDay } from "@/lib/dates";
import type { ShelfItem } from "@/db/types";

/**
 * Печатные формы (аудит п.27): акт списания и список просроченного.
 *
 * Решение — HTML + window.print(), без генераторов PDF: приложение работает
 * оффлайн, а браузер и на телефоне, и на ПК умеет сохранять страницу в PDF.
 * Форма рендерится в отдельный #print-root вне обычного дерева: CSS прячет
 * интерфейс на время печати и показывает только форму.
 */

/** Организация в шапке форм — то же название, что в интерфейсе. */
const ORG_TITLE = "Санаторий «Русь»";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Печать произвольной HTML-формы. Контент кладётся в скрытый контейнер,
 * после отрисовки вызывается системный диалог печати, контент убирается.
 */
export function printHtml(title: string, bodyHtml: string): void {
  const root = document.getElementById("print-root");
  if (!root) return;

  root.innerHTML = `
    <div class="print-doc">
      <h1 class="print-title">${esc(title)}</h1>
      <p class="print-sub">${esc(ORG_TITLE)} · ${formatRu(startOfDay(new Date()))}</p>
      ${bodyHtml}
    </div>`;

  // Форсируем пересчёт макета и печатаем сразу. Раньше здесь был двойной
  // requestAnimationFrame — но в фоновой вкладке (и на части мобильных
  // браузеров) rAF не срабатывает вовсе, и диалог печати не открывался.
  // Чтение offsetHeight заставляет браузер разложить добавленный DOM
  // синхронно, дальше window.print() видит уже готовую форму.
  void root.offsetHeight;
  window.print();

  // Убираем после: повторная печать той же формы ставит свежий контент.
  window.setTimeout(() => {
    root.innerHTML = "";
  }, 500);
}

function table(header: string[], rows: string[][]): string {
  return `
    <table class="print-table">
      <thead><tr>${header.map((cell) => `<th>${esc(cell)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
}

/**
 * Акт списания: позиции со статусом written_off, сгруппированные по дате акта.
 * Графы подписей — как в бумажном акте, который бухгалтерия прикладывает.
 */
export function printWriteOffAct(items: ShelfItem[], actDate?: string): void {
  const written = items
    .filter((item) => item.status === "written_off")
    .filter((item) => !actDate || (item.writtenOffAt ?? "").slice(0, 10) === actDate)
    .sort((a, b) => (a.writtenOffAt ?? "").localeCompare(b.writtenOffAt ?? ""));

  if (written.length === 0) return;

  const rows = written.map((item) => [
    esc(item.name),
    esc(item.supplier),
    formatRu(item.expiresAt),
    formatRu(item.writtenOffAt),
  ]);

  const dateLabel = actDate ? formatRu(actDate) : "за все даты";

  printHtml(
    `Акт на списание (${dateLabel})`,
    `
    ${table(["Наименование", "Поставщик", "Годен до", "Дата акта"], rows)}
    <p class="print-total">Итого позиций: ${written.length}</p>
    <div class="print-signatures">
      <div><span>Списал:</span><span class="print-line"></span></div>
      <div><span>Принял:</span><span class="print-line"></span></div>
    </div>`,
  );
}

/** Список просроченного: позиции в наличии, срок которых уже прошёл. */
export function printExpiredList(items: ShelfItem[], on: Date = startOfDay(new Date())): void {
  const expired = items
    .filter((item) => item.status === "in_stock")
    .filter((item) => {
      const d = parseISODate(item.expiresAt);
      return d !== null && daysBetween(on, d) < 0;
    })
    .sort((a, b) => (a.expiresAt ?? "").localeCompare(b.expiresAt ?? ""));

  if (expired.length === 0) return;

  const rows = expired.map((item) => {
    const d = parseISODate(item.expiresAt);
    const days = d ? Math.abs(daysBetween(on, d)) : 0;
    return [
      esc(item.name),
      esc(item.supplier),
      formatRu(item.expiresAt),
      `${days} ${pluralDays(days)}`,
    ];
  });

  printHtml(
    "Просроченные позиции (в наличии)",
    `
    ${table(["Наименование", "Поставщик", "Годен до", "Просрочено на"], rows)}
    <p class="print-total">Итого позиций: ${expired.length}</p>
    <div class="print-signatures">
      <div><span>Проверил:</span><span class="print-line"></span></div>
    </div>`,
  );
}
