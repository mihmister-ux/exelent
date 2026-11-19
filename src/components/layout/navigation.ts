import * as React from "react";
import { Archive, Clock, FileUp, Package, Users } from "lucide-react";
import { useLocation } from "react-router-dom";

export type TabId = "shelf" | "items" | "invoice" | "archive" | "suppliers";

export interface Tab {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  /** Короткая подпись для док-бара на телефоне. */
  short: string;
}

/** Пять разделов приложения: два действия вместо девяти колонок Excel. */
export const TABS: readonly Tab[] = [
  { id: "shelf", label: "Сроки", short: "Сроки", icon: Clock, path: "/" },
  { id: "items", label: "Товары", short: "Товары", icon: Package, path: "/items" },
  { id: "invoice", label: "Загрузка накладной", short: "Накладная", icon: FileUp, path: "/invoice" },
  { id: "archive", label: "Архив / выбывшие", short: "Архив", icon: Archive, path: "/archive" },
  { id: "suppliers", label: "Поставщики", short: "Поставщики", icon: Users, path: "/suppliers" },
];

/** Самый длинный подходящий путь — чтобы «/items/42» подсвечивал «Товары». */
export function matchTab(pathname: string, tabs: readonly Tab[] = TABS): TabId | null {
  let best: Tab | undefined;

  for (const tab of tabs) {
    const matches =
      tab.path === "/" ? pathname === "/" : pathname === tab.path || pathname.startsWith(`${tab.path}/`);
    if (matches && (!best || tab.path.length > best.path.length)) best = tab;
  }

  return best?.id ?? null;
}

export function useActiveTab(tabs: readonly Tab[] = TABS): TabId | null {
  const { pathname } = useLocation();
  return React.useMemo(() => matchTab(pathname, tabs), [pathname, tabs]);
}
