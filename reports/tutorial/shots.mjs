/**
 * Скриншоты экранов приложения для видео-инструкции.
 *
 * Почему отдельным скриптом, а не руками: кадры в ролике должны быть
 * настоящими, из живого приложения, и обновляться одной командой, когда
 * интерфейс поменяется. Каждый кадр — конкретный шаг инструкции.
 *
 * Запуск: node reports/tutorial/shots.mjs [--url http://127.0.0.1:5173]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "video", "promo", "package.json"));
const puppeteer = require("puppeteer-core");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const args = process.argv.slice(2);
const urlArg = args.indexOf("--url");
const BASE = urlArg !== -1 ? args[urlArg + 1] : "http://127.0.0.1:5173";
const OUT = path.join(here, "assets");
const WIDTH = 1280;
const HEIGHT = 720;

fs.mkdirSync(OUT, { recursive: true });

const chrome = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!chrome) throw new Error("Chrome/Edge не найден");

/** Прокрутить так, чтобы элемент стоял по центру окна, и дать кадру устояться. */
const center = async (page, text, offset = 0) => {
  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate(
    ({ text, offset }) => {
      const all = Array.from(document.querySelectorAll("h1,h2,p,article,form,button,label"));
      const hit =
        all.find((e) => (e.textContent || "").trim() === text) ||
        all.find((e) => (e.textContent || "").trim().startsWith(text));
      if (!hit) return;
      const rect = hit.getBoundingClientRect();
      window.scrollTo(0, Math.max(0, window.scrollY + rect.top - 260 + offset));
    },
    { text, offset },
  );
  await page.waitForFunction((y) => window.scrollY !== y, {}, before).catch(() => {});
  await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
};

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), type: "png" });
  console.log("снято:", name);
};

const go = async (page, hash) => {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));
};

const main = async () => {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 },
    args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

  // База живёт в IndexedDB профиля — её надо один раз наполнить.
  await page.goto(`${BASE}/#/`, { waitUntil: "networkidle2", timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes("позиций"), { timeout: 120000 });
  await page.evaluate(() =>
    new Promise((r) => setTimeout(r, 1200)),
  );

  // Анимации гасим: в PNG они дают полупрозрачный кадр.
  const calm = () =>
    page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent =
        "*{animation:none!important;transition:none!important}html{scroll-behavior:auto!important}";
      document.head.appendChild(style);
    });
  await calm();

  // 1. Сроки — общий экран со статусами и списком позиций.
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "01-sroki-top");

  // 2. Загрузка накладной — экран целиком (тут же поле выбора файла).
  await go(page, "/invoice");
  await calm();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "02-invoice");

  // 3. Добавить товар.
  await go(page, "/add");
  await calm();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "03-add");

  // 3б. Одна карточка с кнопками «Продано»/«Списать» — крупным планом.
  await go(page, "/");
  await calm();
  await center(page, "Истекает 31–60 дней");
  await shot(page, "04-card-actions");

  // 4. Выгрузка в Excel: экран целиком, затем блок резервной копии.
  await go(page, "/export");
  await calm();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "05-export");
  await center(page, "Резервная копия", 40);
  await shot(page, "06-backup");

  // 5. Архив — куда уходит проданное и списанное.
  await go(page, "/archive");
  await calm();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "07-archive");

  await browser.close();
  console.log("готово:", OUT);
};

main().catch((error) => {
  console.error("shots: ОШИБКА —", error.message);
  process.exit(1);
});
