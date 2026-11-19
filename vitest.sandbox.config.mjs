import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Конфиг только для тестов: без плагинов Vite/Tailwind.
 * Основной vite.config.ts тянет нативный @tailwindcss/oxide, который в
 * песочнице агента не загружается, — а тестам он не нужен вообще.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
