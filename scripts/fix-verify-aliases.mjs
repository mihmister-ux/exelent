// Переписывает алиасы "@/..." в скомпилированных для проверки файлах
// на относительные пути: Node не знает про paths из tsconfig.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "reports", "verify");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let changed = 0;
for (const file of walk(base).filter((f) => f.endsWith(".js"))) {
  const source = readFileSync(file, "utf8");
  const next = source.replace(/(["'])@\/([^"']+)\1/g, (_all, quote, spec) => {
    const target = join(base, spec + ".js");
    let rel = relative(dirname(file), target).split(sep).join("/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    return quote + rel + quote;
  });
  if (next !== source) {
    writeFileSync(file, next);
    changed += 1;
  }
}
console.log("rewritten files:", changed);
