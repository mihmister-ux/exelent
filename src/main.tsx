import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import { toast } from "./components/ui/toast";
import "./index.css";

// Android (Xiaomi/MIUI) вычищает «best-effort» хранилище вместе с IndexedDB.
// Просим постоянное хранилище: журнал склада не должен исчезнуть сам.
// Результат пишем в глобальную переменную — StorageBanner читает синхронно.
function setPersistGranted(granted: boolean) {
  window.__dsPersistGranted = granted;
  window.dispatchEvent(new Event("ds-persist-resolved"));
}

if (navigator.storage?.persist) {
  void navigator.storage.persist().then((granted) => {
    setPersistGranted(granted);
    console.info("[shelf] persistent storage:", granted);
  });
} else {
  // Браузер не поддерживает persist API — сразу считаем, что не защищено.
  setPersistGranted(false);
}

// Отказ в асинхронном действии (запись в базу, чтение файла) раньше уходил
// только в консоль: на экране не происходило ничего, и кладовщик нажимал
// кнопку второй раз. Теперь о причине сообщает тост.
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  const text = (reason instanceof Error ? reason.message : String(reason)).slice(0, 140);
  console.error("[shelf] необработанный отказ:", reason);
  toast(`Ошибка: ${text}`, "danger", 6000);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
