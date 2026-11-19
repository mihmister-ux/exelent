import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserDatamatrixCodeReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { Camera, CameraOff, ImageUp, Info, Keyboard, LoaderCircle, ScanLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { describeChestnyZnak, parseChestnyZnak } from "@/domain/chestny-znak";

/**
 * Сканер DataMatrix для кодов «Честный знак».
 *
 * Основной движок — ZXing: он декодирует DataMatrix и с камеры, и с картинки.
 * Нативный BarcodeDetector используется как fallback, если он доступен.
 * Ручной ввод идёт тем же путём (accept → разбор → подстановка в товар).
 *
 * Важно про браузеры: быстрый встроенный декодер (`BarcodeDetector`) есть
 * в Chrome на Android и Safari на iOS. В настольном Chrome, Firefox и в
 * Electron его нет — там остаётся ZXing, который читает код только с чёткой
 * картинки. Поэтому на таких платформах мы сразу и честно предлагаем два
 * рабочих пути: загрузить фото марки или ввести код вручную.
 */

export interface DataMatrixScannerProps {
  open: boolean;
  onClose: () => void;
  /** Вызвать с сырой строкой скана (GTIN+серийник+хвост). */
  onDetected: (raw: string) => void;
}

interface NativeDetectedBarcode {
  rawValue: string;
  format: string;
}
interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<NativeDetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => NativeBarcodeDetector;

/** Что известно про быстрый встроенный декодер браузера. */
type NativeDecoder = "checking" | "ready" | "missing";

/** Создаём ZXing-читатель с подсказкой только про DataMatrix. */
function createZxingReader(): BrowserDatamatrixCodeReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, ["DATA_MATRIX"]);
  return new BrowserDatamatrixCodeReader(hints);
}

/** Ошибку ZXing переводим в совет, что делать человеку. */
function explainImageFailure(error: unknown): string {
  const name = error instanceof Error ? error.message : String(error);
  if (/Checksum|Format/i.test(name)) {
    return "Код на фото найден, но не читается: сфотографируйте марку ближе, резче и без бликов.";
  }
  if (/NotFound/i.test(name)) {
    return "На фото не видно кода: снимите марку крупно, чтобы квадратный код занимал большую часть кадра.";
  }
  return "Файл не удалось прочитать. Попробуйте другое фото — крупнее и резче.";
}

export function DataMatrixScanner({ open, onClose, onDetected }: DataMatrixScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeTimerRef = useRef<number | null>(null);
  const zxingTimerRef = useRef<number | null>(null);
  const detectedRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "unsupported">("idle");
  const [message, setMessage] = useState("");
  const [engine, setEngine] = useState<"native" | "zxing" | "none">("none");
  const [manualCode, setManualCode] = useState("");
  const [nativeDecoder, setNativeDecoder] = useState<NativeDecoder>("checking");

  /** Файл картинки: ZXing декодирует DataMatrix без камеры. */
  const [imageName, setImageName] = useState("");

  const stop = useCallback(() => {
    for (const timer of [nativeTimerRef.current, zxingTimerRef.current]) {
      if (timer !== null) window.clearInterval(timer);
    }
    nativeTimerRef.current = null;
    zxingTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const accept = useCallback(
    (raw: string) => {
      if (!raw || detectedRef.current) return;
      detectedRef.current = true;
      stop();
      onDetected(raw);
      onClose();
    },
    [onDetected, onClose, stop],
  );

  /** Ручной ввод — тот же путь, что и скан: accept() → разбор → товар. */
  const acceptManual = () => {
    const raw = manualCode.trim();
    if (!raw) {
      toast("Введите код маркировки", "danger");
      return;
    }
    const code = parseChestnyZnak(raw);
    accept(code.raw);
  };

  /** Распознать выбранную картинку через ZXing — рабочий путь без камеры. */
  const scanImage = async (file: File) => {
    setImageName(file.name);
    setMessage("");
    detectedRef.current = false;
    try {
      const reader = createZxingReader();
      const result = await reader.decodeFromImageUrl(URL.createObjectURL(file));
      const raw = result.getText();
      if (!raw) throw new Error("NotFound");
      accept(raw);
    } catch (error) {
      const advice = explainImageFailure(error);
      toast(advice, "danger");
      setMessage(advice);
    }
  };

  const start = useCallback(async () => {
    setStatus("starting");
    setMessage("");
    detectedRef.current = false;
    stop();

    const constraints: MediaStreamConstraints = {
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    };

    // 1. Нативный BarcodeDetector, если браузер умеет data_matrix.
    const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (typeof ctor !== "function") {
      setNativeDecoder("missing");
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) throw new Error("Видеоэлемент не готов");
        video.srcObject = stream;
        await video.play();

        const withFormats = ctor as BarcodeDetectorCtor & {
          getSupportedFormats?: () => Promise<string[]>;
        };
        let formats: string[] = [];
        if (typeof withFormats.getSupportedFormats === "function") {
          formats = await withFormats.getSupportedFormats().catch(() => []);
        }
        if (formats.length === 0 || formats.includes("data_matrix")) {
          const detector = new ctor({ formats: ["data_matrix"] });
          setNativeDecoder("ready");
          setEngine("native");
          setStatus("scanning");
          nativeTimerRef.current = window.setInterval(async () => {
            if (detectedRef.current || video.readyState < 2) return;
            try {
              const found = await detector.detect(video);
              const hit = found.find((barcode) => barcode.rawValue);
              if (hit) accept(hit.rawValue);
            } catch {
              // Кадр ещё не готов — следующий тик попробует снова.
            }
          }, 250);
          return;
        }
        // Декодер есть, но DataMatrix не умеет — работает резервный путь.
        setNativeDecoder("missing");
        stop();
      } catch {
        stop();
      }
    }

    // 2. Fallback на ZXing: камера через getUserMedia, декодирование canvas.
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Видеоэлемент не готов");
      video.srcObject = stream;
      await video.play();

      const reader = createZxingReader();
      setEngine("zxing");
      setStatus("scanning");
      zxingTimerRef.current = window.setInterval(() => {
        if (detectedRef.current || video.readyState < 2) return;
        try {
          const result = reader.decode(video);
          const raw = result.getText();
          if (raw) accept(raw);
        } catch {
          // Кадр ещё не готов или код не найден — пробуем следующий.
        }
      }, 250);
    } catch {
      stop();
      setEngine("none");
      setStatus("unsupported");
      setMessage("");
    }
  }, [accept, stop]);

  useEffect(() => {
    if (!open) {
      stop();
      setStatus("idle");
      setMessage("");
      setImageName("");
      return;
    }
    void start();
    return stop;
  }, [open, start, stop]);

  const cameraBlocked = status === "unsupported";
  /** Нет быстрого декодера — на этой платформе фото и ручной ввод надёжнее камеры. */
  const slowEngine = nativeDecoder === "missing";
  const photoRecommended = cameraBlocked || slowEngine;

  const statusLabel =
    status === "scanning"
      ? engine === "native"
        ? "Сканирует: быстрый встроенный декодер"
        : "Сканирует: резервный декодер"
      : status === "starting"
        ? "Включаем камеру…"
        : cameraBlocked
          ? "Камера недоступна"
          : "Ожидание";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Сканировать марку"
      description="Наведите камеру на DataMatrix или загрузите картинку с кодом — код подставится сам."
    >
      <div className="space-y-3">
        {cameraBlocked ? (
          <div className="rounded-xl border border-border bg-muted/60 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CameraOff className="size-4 shrink-0" /> Камера недоступна
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Марку всё равно можно прочитать — двумя способами ниже: загрузите фото марки или
              введите код вручную.
            </p>
          </div>
        ) : (
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} muted playsInline className="size-full object-cover" />
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="size-40 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            {status === "starting" ? (
              <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-white">
                <span className="flex items-center gap-2">
                  <LoaderCircle className="size-4 animate-spin" /> Включаем камеру…
                </span>
              </div>
            ) : null}
          </div>
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ScanLine className="size-4 shrink-0" />
          {statusLabel}
        </p>

        {slowEngine && !cameraBlocked ? (
          <div className="flex items-start gap-2 rounded-xl bg-secondary/70 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              В этом браузере нет быстрого встроенного декодера марок (он есть в Chrome на Android
              и Safari на iPhone). Резервный декодер читает код только с чёткой картинки, поэтому
              надёжнее загрузить фото марки или ввести код вручную.
            </span>
          </div>
        ) : null}

        <div
          className={
            photoRecommended
              ? "rounded-xl border border-primary/40 bg-secondary/40 p-3"
              : "rounded-xl border border-dashed border-border p-3"
          }
        >
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <ImageUp className="size-4 shrink-0" /> Фото марки
            {photoRecommended ? (
              <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                Рекомендуется
              </span>
            ) : null}
          </p>
          <p className="mb-2 text-xs text-muted-foreground">
            Сфотографируйте марку крупно, резко и без бликов — квадратный код должен занимать
            большую часть кадра.
          </p>
          <Input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void scanImage(file);
            }}
            className="text-xs"
          />
          {imageName ? <p className="mt-2 text-xs text-muted-foreground">Файл: {imageName}</p> : null}
          {message ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>{message}</span>
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-dashed border-border p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Keyboard className="size-4 shrink-0" /> Ввести код вручную
          </p>
          <Field
            label="Строка DataMatrix"
            hint="Для теста без камеры. Например: 010460123456789021SER999"
          >
            <Input
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") acceptManual();
              }}
              placeholder="010460123456789021SER999"
              className="font-mono text-xs"
            />
          </Field>
          {manualCode.trim() ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {describeChestnyZnak(parseChestnyZnak(manualCode.trim()))}
            </p>
          ) : null}
          <Button className="mt-2 w-full" onClick={acceptManual} disabled={!manualCode.trim()}>
            <ScanLine className="size-4" /> Подставить код
          </Button>
        </div>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void start()} disabled={status === "starting"}>
            <Camera className="size-4" /> Повторить
          </Button>
          <Button variant="outline" onClick={onClose}>
            <X className="size-4" /> Закрыть
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
