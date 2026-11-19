import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import { BottomDock, DockSpacer } from "@/components/layout/BottomDock";
import { SideNav } from "@/components/layout/SideNav";

/** Скелет на время, пока грузится отложенная страница. */
function PageSkeleton() {
  return (
    <div className="space-y-3" aria-busy>
      <div className="h-8 w-40 animate-pulse rounded-xl bg-secondary" />
      <div className="h-24 animate-pulse rounded-lg bg-secondary/70" />
      <div className="h-24 animate-pulse rounded-lg bg-secondary/70" />
    </div>
  );
}

/**
 * Каркас: на телефоне — одна колонка с нижним доком, на широком экране —
 * боковая навигация. Складу нужен телефон, но журнал смотрят и на ПК.
 */
export default function AppLayout() {
  return (
    <div className="min-h-dvh">
      <SideNav />

      <div className="md:pl-64">
        <div className="mx-auto w-full max-w-md px-4 pt-4 md:max-w-5xl md:px-8 md:pt-7">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
          <DockSpacer />
        </div>
      </div>

      <BottomDock />

      {/* Внешний контейнер печатных форм: CSS прячет его на экране и
          показывает при window.print(), чтобы не смешивался с интерфейсом. */}
      <div id="print-root" aria-hidden className="print-root" />
    </div>
  );
}
