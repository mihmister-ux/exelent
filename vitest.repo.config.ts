import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    // reports/ не прогоняем НИКОГДА: одноразовая диагностика на настоящих
    // счетах и накладных (PDF, xlsx из fixtures/). Исключение стоит здесь, а не
    // в vite.config.ts, потому что root-конфиг нужен dev и build, а тестам —
    // этот: через него идёт и vitest.repo.config.ts, и CI-прогон.
    // Если исключение положить в vite.config.ts, node-тесты потянут
    // @tailwindcss/oxide и не загрузятся в песочнице.
    exclude: ["node_modules", "dist", "reports/**"],
  },
});