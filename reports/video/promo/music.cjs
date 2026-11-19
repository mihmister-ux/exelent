/**
 * Генератор фоновой мелодии для ролика — ровно та же прогрессия, что играет
 * в index.html через Web Audio, но посчитанная в файл.
 *
 * Нужно потому, что Web Audio живёт только в браузере: чтобы вставить музыку
 * в MP4, её приходится синтезировать отдельно (без внешних mp3 — нет файлов,
 * нет проблем с авторскими правами).
 *
 * Запуск:  node music.cjs [out.wav]
 */
const fs = require('fs');
const path = require('path');

const TOTAL = 38;          // секунд — совпадает с TOTAL в index.html
const BARS = 8;            // 8 тактов
const BAR = TOTAL / BARS;  // 4.75 с на такт
const SR = 44100;

/* Am - F - C - G (те же частоты, что в index.html) */
const CHORDS = [
  [220.00, 261.63, 329.63],
  [174.61, 220.00, 261.63],
  [261.63, 329.63, 392.00],
  [196.00, 246.94, 293.66],
];

const buf = new Float32Array(Math.ceil(TOTAL * SR) + SR);

/** Сложение ноты в буфер: атака 0.14 с, затем экспоненциальный спад. */
function addNote(freq, t0, dur, peak, wave) {
  const start = Math.floor(t0 * SR);
  const len = Math.floor((dur + 0.06) * SR);
  for (let i = 0; i < len; i += 1) {
    const idx = start + i;
    if (idx < 0 || idx >= buf.length) continue;
    const t = i / SR;
    let env;
    if (t < 0.14) env = peak * (t / 0.14);
    else env = peak * Math.exp(-(t - 0.14) / (dur * 0.36));
    // Обрыв только ПОСЛЕ атаки: на t=0 огибающая равна нулю, и ранняя
    // проверка убивала ноту на первом же сэмпле (получалась тишина -91 dB).
    if (t >= 0.14 && env < 1e-5) break;
    const phase = 2 * Math.PI * freq * t;
    const s = wave === 'triangle'
      ? (2 / Math.PI) * Math.asin(Math.sin(phase))
      : Math.sin(phase);
    buf[idx] += env * s;
  }
}

for (let bar = 0; bar < BARS; bar += 1) {
  const freqs = CHORDS[bar % CHORDS.length];
  const t0 = bar * BAR;
  // тихая подложка-аккорд
  freqs.forEach((f, i) => addNote(f, t0 + i * 0.05, BAR * 1.05, 0.030, 'sine'));
  // редкое арпеджио «колокольчиком»
  const steps = 8;
  for (let s = 0; s < steps; s += 1) {
    const f = freqs[s % freqs.length] * 2;
    addNote(f, t0 + s * (BAR / steps), 0.95, 0.016, 'triangle');
  }
}

/* Общая громкость 0.85 + плавное появление и затухание в финале. */
const MASTER = 0.85;
const FADE_IN = 1.2;
const FADE_OUT = 2.0;
const n = Math.floor(TOTAL * SR);

const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i += 1) {
  const t = i / SR;
  let g = MASTER;
  if (t < FADE_IN) g *= t / FADE_IN;
  const left = TOTAL - t;
  if (left < FADE_OUT) g *= left / FADE_OUT;
  let v = buf[i] * g;
  if (v > 0.99) v = 0.99;
  if (v < -0.99) v = -0.99;
  pcm.writeInt16LE(Math.round(v * 32767), i * 2);
}

/* Заголовок WAV (PCM 16 бит, моно, 44100 Гц). */
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);            // PCM
header.writeUInt16LE(1, 22);            // каналов
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);       // байт в секунду
header.writeUInt16LE(2, 32);            // выравнивание блока
header.writeUInt16LE(16, 34);           // бит на сэмпл
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const out = process.argv[2] || path.join(__dirname, 'build', 'music.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`music: ${out} — ${TOTAL} с, ${BARS} такта, ${(pcm.length / 1024 / 1024).toFixed(1)} МБ`);
