/**
 * Сборка MP4 из покадровых изображений сцен с кроссфейдами + музыка.
 *
 * Если бы не песочница Windows (запрещает headless Chrome), кадры снимались
 * бы через window.__seek(t) покадрово. Здесь сцены сняты ключевыми кадрами
 * из живого браузера, а плавность дают кроссфейды FFmpeg.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const FF = path.join(DIR, 'bin', 'ffmpeg.exe');
const B = path.join(DIR, 'build');
const FFMPEG_LOG = path.join(B, 'ffmpeg-build.log');

// duration in seconds; совпадает с DUR в index.html
const DUR = [7, 7, 6, 7, 6, 5];
const XF = 0.6;

// Правильная длительность = сумма длин сцен minus наложения кроссфейдов.
const TOTAL = DUR.reduce((a, b) => a + b, 0) - XF * (DUR.length - 1);

const args = ['-y', '-hide_banner'];
for (let i = 0; i < DUR.length; i += 1) {
  args.push('-loop', '1', '-framerate', '30', '-t', String(DUR[i]), '-i', path.join(B, `scene-s${i}.png`));
}
args.push('-i', path.join(B, 'music.wav'));

const filters = [];
// xfade: clips 0..N sequential. Каждый следующий начинается на
// (сумма предыдущих длин - k*xfade) и перекрывает prev на XF.
let offset = DUR[0] - XF;
for (let i = 1; i < DUR.length; i += 1) {
  const left = i === 1 ? '0:v' : `x${i - 1}`;
  filters.push(
    `[${left}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${offset.toFixed(3)}[x${i}]`
  );
  offset += DUR[i] - XF;
}
filters.push(`[x${DUR.length - 1}]format=yuv420p,setsar=1,fps=30[v]`);
// Музыка: усечь ровно до TOTAL и снять метки времени, иначе AAC пишет тишину.
// Мелодия синтезируется тихой (пик ≈ -22 dB), поэтому поднимаем уровень и
// мягко ограничиваем — иначе в плеере ролик звучит почти без звука.
filters.push(
  `[${DUR.length}:a]atrim=0:${TOTAL.toFixed(3)},asetpts=PTS-STARTPTS,` +
  `volume=17dB,alimiter=limit=0.95:level=disabled[a]`
);

args.push('-filter_complex', filters.join(';'));
args.push('-map', '[v]', '-map', '[a]');
args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20');
args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '44100');
args.push('-movflags', '+faststart');
args.push('-t', TOTAL.toFixed(3));
args.push(path.join(B, 'promo.mp4'));

console.log(`строим ролик: ${TOTAL.toFixed(2)} с, ${DUR.length} сцен, кроссфейд ${XF} с`);
console.log('filter:', filters.join(';'));

const logFd = fs.openSync(FFMPEG_LOG, 'w');
const r = spawnSync(FF, args, { stdio: ['ignore', logFd, logFd], cwd: DIR });
fs.closeSync(logFd);
const tail = fs.readFileSync(FFMPEG_LOG, 'utf8').split('\n').slice(-22).join('\n');
console.log(tail);

if (r.status !== 0) {
  console.error('ffmpeg завершился с кодом', r.status);
  process.exit(1);
}

// Проверка: вывести реальные параметры готового файла.
const probe = spawnSync(FF, ['-hide_banner', '-i', path.join(B, 'promo.mp4'), '-f', 'null', '-'],
  { encoding: 'utf8', cwd: DIR });
const lines = (probe.stderr || '').split('\n').filter((l) => l.includes('Duration:') || l.includes('Stream #'));
console.log('\nитог:');
lines.forEach((l) => console.log(' ', l.trim()));
console.log('файл:', path.join(B, 'promo.mp4'), fs.statSync(path.join(B, 'promo.mp4')).size, 'байт');
