/**
 * Обход песочницы: vite при первом realpath-вызове запускает `net use` через
 * child_process.exec, а песочница запрещает программы с перехваченным выводом.
 * Заглушка отдаёт ошибку — vite просто остаётся на fs.realpathSync (ветка
 * «сетевых дисков нет»), и тесты запускаются без обращения к сети.
 */
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

cp.exec = (command, options, callback) => {
  const cb = typeof options === "function" ? options : callback;
  if (typeof cb === "function") cb(new Error("stub: child_process disabled"), "", "");
  return { on() {}, once() {}, kill() {} };
};
syncBuiltinESMExports();
