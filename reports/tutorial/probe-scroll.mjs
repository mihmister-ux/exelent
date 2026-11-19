/** Отладка прокрутки: что видит скрипт скриншотов. */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "video", "promo", "package.json"));
const puppeteer = require("puppeteer-core");

const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:5173/#/", { waitUntil: "networkidle2", timeout: 120000 });
await page.waitForFunction(() => document.body.innerText.includes("позиций"), { timeout: 120000 });
await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

const info = await page.evaluate(() => {
  const probes = [];
  for (const sel of ["html", "body", "#root", "main", "[class*=overflow]"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    probes.push({
      sel,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    });
  }
  return {
    winScrollY: window.scrollY,
    docScrollH: document.documentElement.scrollHeight,
    bodyScrollH: document.body.scrollHeight,
    probes,
  };
});
console.log(JSON.stringify(info, null, 2));

const found = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("h1,h2,p,article,form,button,label"));
  const hit = all.find((e) => (e.textContent || "").trim().startsWith("Истекает ≤30 дней"));
  return hit ? { tag: hit.tagName, text: hit.textContent.trim().slice(0, 40), top: hit.getBoundingClientRect().top } : null;
});
console.log("found:", JSON.stringify(found));

const after = await page.evaluate(() => {
  window.scrollTo(0, 1500);
  return { scrollY: window.scrollY };
});
console.log("after scrollTo:", JSON.stringify(after));

await browser.close();
