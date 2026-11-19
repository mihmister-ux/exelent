import { DatabaseBackup, FileSpreadsheet } from "lucide-react";
import type { ComponentType } from "react";

/**
 * Пункты шефф-меню «Ещё» на телефоне.
 *
 * Нижний док на всех телефонах — 360–430px шириной, а в нём уже четыре
 * раздела и акцентная «+» по центру. Шестой кнопки там нет физически: каждая
 * становится 44px, подписи не влезают. Поэтому «Добавить товар» и
 * «Загрузить накладную» уходят в док (ими пользуются каждый день), а
 * «Экспорт в Excel» и «Резервная копия» — сюда, в шторку.
 *
 * Модуль отдельный и без React нарочно: состав меню и подсветку активного
 * пункта проверяет тест, не поднимая jsdom.
 */

export type MoreId = "export" | "backup";

/**
 * Иконка пункта. Именно `ComponentType`, а не `LucideIcon`: в шторку
 * попадают и разделы из `Tab`, где иконка описана так же широко. Более узкий
 * тип `LucideIcon` (forwardRef-компонент) с ними не совместим, и `tsc -b`
 * на этом падает.
 */
type MenuIcon = ComponentType<{ className?: string }>;

export interface MoreAction {
  id: MoreId;
  title: string;
  hint: string;
  path: string;
  icon: MenuIcon;
}

export const MORE_ACTIONS: readonly MoreAction[] = [
  {
    id: "export",
    title: "Выгрузить в Excel",
    hint: "Файл журнала на это устройство",
    path: "/export",
    icon: FileSpreadsheet,
  },
  {
    id: "backup",
    title: "Резервная копия",
    hint: "Сохранить журнал в файл и восстановить из файла",
    path: "/export#backup",
    icon: DatabaseBackup,
  },
];

/**
 * Пункт меню, к которому относится якорь адреса, — для подсветки.
 *
 * Страница экспорта общая для двух пунктов, поэтому различаем их по якорю:
 * «#backup» — это блок «Резервная копия» справа внизу, иначе — сама выгрузка.
 */
export function moreTarget(hash: string): MoreId {
  return hash.endsWith("#backup") ? "backup" : "export";
}

export interface MoreLink {
  /** Ключ для React — уникален внутри шторки. */
  key: string;
  id: string;
  title: string;
  path: string;
  icon: MenuIcon;
}

/**
 * Что показать в шторке: сначала всегда меню, потом — по необходимости —
 * остальные разделы.
 *
 * На узком экране в док влезает не больше четырех вкладок: две слева от «+»
 * и две справа. Хвост списка разделов док сюда и передаёт, чтобы кнопка
 * «Поставщики» не пропала с телефона. На широком экране хвоста нет — вся
 * навигация живёт в боковой панели.
 */
export function moreLinks(overflow: readonly MoreLink[] = []): MoreLink[] {
  // Ключи пунктов меню не пересекаются с ключами разделов («export» против
  // «tab-suppliers»), поэтому React не спутает строки при смене состава.
  return [
    ...MORE_ACTIONS.map((action) => ({
      key: action.id,
      id: action.id,
      title: action.title,
      path: action.path,
      icon: action.icon,
    })),
    ...overflow,
  ];
}
