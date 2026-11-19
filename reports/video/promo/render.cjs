/**
 * Покадровый рендер промо-ролика: HTML -> кадры -> MP4.
 *
 * Почему так, а не «записать экран»:
 *   кадр определяется функцией window.__seek(t) внутри index.html, поэтому
 *   картинка детерминированная — один и тот же t всегда даёт один и тот же
 *   кадр. Никаких пропущенных кадров и дрожания от загрузки машины.
 *
 * Запуск:  node render.cjs [--fps 30] [--out build/promo.mp4] [--keep]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const FFMPEG = path.join(__dirname, 'bin', 'ffmpeg.exe');
const PAGE = path.join(__dirname, 'index.html');
const BUILD = path.join(__dirname, 'build');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FPS = Number(arg('fps', 30));
const OUT = path.resolve(arg('out', path.join(BUILD, 'promo.mp4')));
const KEEP = process.argv.includes('--keep');

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome/Edge не найден');
  return found;
}

/** GET по HTTP — ждём, пока Chrome поднимет CDP-порт. */
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

/**
 * Запуск Chrome «своими руками».
 *
 * Так, а не через puppeteer.launch, потому что в песочнице Windows дочерний
 * процесс с piped stdio падает с EPERM. С stdio: 'ignore' запуск проходит,
 * а управляем мы им по CDP — тот же результат.
 */
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

  const port = 9300 + Math.floor(Math.random() * 400);
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

    // Ждём, пока все скриншоты внутри «окон» реально загрузятся.
    await page.waitForFunction(
      () => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0),
      { timeout: 60000 },
    );

    const total = await page.evaluate(() => window.__total);
    const count = Math.round(total * FPS);
    console.log(`render: длительность ${total} с -> ${count} кадров`);

    const t0 = Date.now();
    for (let i = 0; i < count; i += 1) {
      const t = i / FPS;
      await page.evaluate((tt) => window.__seek(tt), t);
      // два кадра анимации: гарантия, что браузер перерисовал состояние
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      await page.screenshot({
        path: path.join(framesDir, `f${String(i + 1).padStart(5, '0')}.jpg`),
        type: 'jpeg',
        quality: 96,
        optimizeForSpeed: true,
      });
      if ((i + 1) % 120 === 0 || i === count - 1) {
        const sec = (Date.now() - t0) / 1000;
        const eta = ((count - i - 1) * (sec / (i + 1))).toFixed(0);
        console.log(`render: кадр ${i + 1}/${count} — ${sec.toFixed(0)} с, осталось ~${eta} с`);
      }
    }
  } finally {
    await browser.disconnect();
    try { child.kill(); } catch (e) { /* уже закрылся */ }
  }

  console.log('render: кадры готовы, склейка с музыкой…');
  const ffmpeg = require('child_process').spawnSync(
    FFMPEG,
    [
      '-y',
      '-framerate', String(FPS),
      '-i', path.join(BUILD, 'frames', 'f%05d.jpg'),
      '-i', path.join(BUILD, 'music.wav'),
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '160k',
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
