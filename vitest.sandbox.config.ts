import { defineConfig } from "vitest/config";

/**
 * Конфиг для прогона тестов в песочнице: без Vite-плагинов (Tailwind/React/PWA),
 * потому что их нативные модули и spawn недоступны под ограничениями песочницы.
 * Для юнит-тестов чистой логики плагины не нужны.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
