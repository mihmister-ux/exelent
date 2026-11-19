import { lazy, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Tags } from "lucide-react";

import AppLayout from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { StorageBanner } from "@/components/ui/StorageBanner";
import { Toaster } from "@/components/ui/toast";
import { ensureSeeded } from "@/db/seed";

/**
 * Первый экран остаётся в стартовом чанке, остальные — по требованию:
 * на складе телефон и небыстрый интернет, лишний вес на старте не нужен.
 */
const ShelfPage = lazy(() => import("@/features/shelf/ShelfPage"));
const ItemsPage = lazy(() => import("@/features/items/ItemsPage"));
const InvoicePage = lazy(() => import("@/features/invoice/InvoicePage"));
const ArchivePage = lazy(() => import("@/features/archive/ArchivePage"));
const AddItemPage = lazy(() => import("@/features/add/AddItemPage"));
const ExportPage = lazy(() => import("@/features/export/ExportPage"));
const SuppliersPage = lazy(() => import("@/features/suppliers/SuppliersPage"));

type BootState = "loading" | "ready" | "error";

export default function App() {
  const [state, setState] = useState<BootState>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    // Первый запуск заливает 146 строк из data/shelf-data.json в IndexedDB.
    ensureSeeded()
      .then((result) => {
        if (cancelled) return;
        console.info("[shelf] первичный импорт:", result);
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        console.error("[shelf] база не подготовлена:", cause);
        setError(cause instanceof Error ? cause.message : String(cause));
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state !== "ready") return <Splash state={state} error={error} />;

  return (
    <HashRouter>
      <StorageBanner />
      {/* Граница внутри роутера: заглушка не мешает хеш-навигации. */}
      <ErrorBoundary>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<ShelfPage />} />
            <Route path="/items" element={<ItemsPage />} />
            <Route path="/invoice" element={<InvoicePage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/add" element={<AddItemPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>

      <Toaster />
    </HashRouter>
  );
}

/** Заставка на время импорта: журнал не показываем, пока он не собран целиком. */
function Splash({ state, error }: { state: BootState; error: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm space-y-3 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Tags className="size-5" />
        </div>
        <p className="text-xl font-semibold">Сроки годности</p>

        {state === "loading" ? (
          <p className="text-sm text-muted-foreground">Готовим журнал: 146 позиций из Excel…</p>
        ) : (
          <>
            <p className="text-sm text-destructive">Не удалось открыть локальную базу</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <p className="text-xs text-muted-foreground">
              Обычно помогает закрыть режим инкогнито или разрешить хранение данных сайту.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
