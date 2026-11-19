/**
 * Покадровый рендер видео-инструкции «Сроки годности за 5 шагов».
 *
 * Тот же принцип, что и у промо-ролика: каждый кадр — детерминированная
 * функция window.__seek(t), так что картинка не дрожит и не зависит от
 * скорости машины. Chrome запускается своими руками с stdio: 'ignore'
 * (в песочнице piped stdio дочерних процессов падает с EPERM), управляем
 * им по CDP, потом FFmpeg склеивает кадры с музыкой.
 *
 * Запуск:  node render.cjs [--fps 30] [--out build/tutorial.mp4] [--keep]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

// puppeteer-core живёт в node_modules промо-папки; тут его не дублируем.
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  try {
    puppeteer = require(path.join(HERE, '..', 'video', 'promo', 'node_modules', 'puppeteer-core'));
  } catch (e2) {
    console.error('render: puppeteer-core не найден ни локально, ни в node_modules промо.');
    console.error('  Подсказка: npm i puppeteer-core в reports/video/promo (как для промо-ролика).');
    process.exit(1);
  }
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const HERE = __dirname;
const FFMPEG = path.join(HERE, '..', 'video', 'promo', 'bin', 'ffmpeg.exe');
const PAGE = path.join(HERE, 'index.html');
const BUILD = path.join(HERE, 'build');
const MUSIC = path.join(HERE, 'music.wav');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FPS = Number(arg('fps', 30));
const OUT = path.resolve(arg('out', path.join(BUILD, 'tutorial.mp4')));
const KEEP = process.argv.includes('--keep');

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome/Edge не найден');
  return found;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await httpGet(`http://127.0.0.1:${port}/json/version`);
      if (r.status === 200) return JSON.parse(r.body);
    } catch (e) { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Chrome не открыл отладочный порт ' + port);
}

function launchChrome(chrome, port, profileDir) {
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--disable-crash-reporter',
    '--disable-dev-shm-usage',
    '--force-device-scale-factor=1',
    '--window-size=1280,720',
    '--user-data-dir=' + profileDir,
    'about:blank',
  ];
  const child = spawn(chrome, args, { stdio: 'ignore', windowsHide: true });
  child.on('error', (e) => console.error('render: chrome spawn —', e.message));
  return child;
}

async function main() {
  const chrome = findChrome();
  const framesDir = path.join(BUILD, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const port = 9400 + Math.floor(Math.random() * 400);
  const profileDir = path.join(BUILD, 'chrome-profile');
  fs.rmSync(profileDir, { recursive: true, force: true });

  console.log(`render: Chrome = ${chrome}`);
  console.log(`render: ${FPS} кадр/с, CDP-порт ${port}`);

  const child = launchChrome(chrome, port, profileDir);
  await waitForCdp(port, 30000);
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.goto('file:///' + PAGE.replace(/\\/g, '/') + '?render=1', {
      waitUntil: 'load',
      timeout: 60000,
    });

    // Заранее грузим скриншоты экранов в кэш браузера — в кадры они должны
    // попасть уже тёплыми, иначе первые секунды шага могут мигнуть пустотой.
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images).map((img) =>
          new Promise((res) => {
            if (img.complete && img.naturalWidth > 0) return res();
            img.onload = () => res();
            img.onerror = () => res();
          }),
        ),
      ),
    );
    await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));

    const total = await page.evaluate(() => window.__total);
    const count = Math.round(total * FPS);
    console.log(`render: длительность ${total} c -> ${count} кадров`);

    const t0 = Date.now();
    for (let i = 0; i < count; i += 1) {
      const t = i / FPS;
      await page.evaluate((tt) => window.__seek(tt), t);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      await page.screenshot({
        path: path.join(framesDir, `f${String(i + 1).padStart(5, '0')}.jpg`),
        type: 'jpeg',
        quality: 94,
        optimizeForSpeed: true,
      });
      if ((i + 1) % 180 === 0 || i === count - 1) {
        const sec = (Date.now() - t0) / 1000;
        const eta = ((count - i - 1) * (sec / (i + 1))).toFixed(0);
        console.log(`render: кадр ${i + 1}/${count} — ${sec.toFixed(0)} c, осталось ~${eta} c`);
      }
    }
  } finally {
    await browser.disconnect();
    try { child.kill(); } catch (e) { /* уже закрылся */ }
  }

  console.log('render: кадры готовы, склейка с музыкой…');
  const ffmpeg = spawnSync(
    FFMPEG,
    [
      '-y',
      '-stream_loop', '-1',
      '-i', MUSIC,
      '-framerate', String(FPS),
      '-i', path.join(framesDir, 'f%05d.jpg'),
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-af', 'afade=t=out:st=49:d=3',
      '-shortest',
      OUT,
    ],
    { stdio: 'inherit' },
  );

  if (ffmpeg.status !== 0) {
    throw new Error('FFmpeg завершился с кодом ' + ffmpeg.status);
  }

  if (!KEEP) {
    fs.rmSync(path.join(BUILD, 'frames'), { recursive: true, force: true });
    fs.rmSync(path.join(BUILD, 'chrome-profile'), { recursive: true, force: true });
  }
  console.log(`render: готово -> ${OUT}`);
}

main().catch((e) => {
  console.error('render: ОШИБКА —', e.message);
  process.exit(1);
});