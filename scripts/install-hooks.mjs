#!/usr/bin/env node
/**
 * install-hooks.mjs — ставит локальный pre-commit хук в .git/hooks/.
 * Запустить один раз после клонирования: node scripts/install-hooks.mjs
 *
 * Хук не попадает в git (.git не версионируется), поэтому образ лежит
 * в scripts/pre-commit. Husky не нужен — одна зависимость меньше.
 */
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const hooksDir = join(process.cwd(), ".git", "hooks");
const from = join(process.cwd(), "scripts", "pre-commit");
const to = join(hooksDir, "pre-commit");

if (!existsSync(from)) {
  console.error("Нет scripts/pre-commit");
  process.exit(1);
}

mkdirSync(hooksDir, { recursive: true });

const desired = readFileSync(from, "utf8");
if (existsSync(to) && readFileSync(to, "utf8") === desired) {
  console.log(`Хук уже актуален: ${to}`);
} else {
  if (existsSync(to)) console.log("Обновляю существующий хук");
  copyFileSync(from, to);
  console.log(`Установлен хук: ${to}`);
}

chmodSync(to, 0o755);
console.log("Права 755 выставлены. Проверка: git commit теперь проходит через guard-staged.");
