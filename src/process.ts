import { pdfjs } from "./pdfjs";
import {
  automaticCandidates,
  boxForCrop,
  contextBand,
  contextualCandidates,
  ocrTokens,
  pdfTextTokens,
} from "./contextual";
import { createWorker, PSM, OEM } from "tesseract.js";
import type { PageRecord } from "./model";
import { areasForScan, type ScanAreas } from "./scan-areas";
import { aggregateReadings, type RegionReading } from "./recognition";
import { readSavedNumbers } from "./pdf";
export type Settings = {
  preserve: number;
  detectionMode: "automatic" | "areas";
  scanAreas: ScanAreas;
  force: boolean;
};
const abortError = () => new DOMException("Processing cancelled", "AbortError");
export async function processPdf(
  bytes: Uint8Array,
  settings: Settings,
  signal: AbortSignal,
  onPage: (page: PageRecord, total: number) => void,
  onStatus: (status: string) => void,
): Promise<PageRecord[]> {
  let document:
    import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy | undefined;
  let loadingTask:
    | import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentLoadingTask
    | undefined;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let rejectOperation: ((error: Error) => void) | undefined;
  // Tesseract may report initialization errors through errorHandler without
  // settling createWorker. Race every operation with a visible failure/abort.
  function guarded<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", stop);
        if (rejectOperation === fail) rejectOperation = undefined;
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const stop = () => fail(abortError());
      const timeout = setTimeout(
        () =>
          fail(
            new Error(
              "OCR took too long. Try a smaller PDF or a smaller scan area.",
            ),
          ),
        120000,
      );
      rejectOperation = fail;
      signal.addEventListener("abort", stop, { once: true });
      operation.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) =>
          fail(error instanceof Error ? error : new Error(String(error))),
      );
      if (signal.aborted) stop();
    });
  }
  const check = () => {
    if (signal.aborted) throw abortError();
  };
  const abort = () => {
    if (worker) void worker.terminate().catch(() => {});
    if (loadingTask) void loadingTask.destroy().catch(() => {});
  };
  signal.addEventListener("abort", abort);
  try {
    check();
    const saved = settings.force
      ? new Map<number, number | null>()
      : await readSavedNumbers(bytes);
    check();
    loadingTask = pdfjs.getDocument({ data: bytes.slice() });
    document = await loadingTask.promise;
    check();
    const pages: PageRecord[] = [];
    for (let index = 0; index < document.numPages; index++) {
      check();
      onStatus(`Reading page ${index + 1} of ${document.numPages}`);
      const page = await document.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2.5,
        1600 / base.width,
        3000 / base.height,
        Math.sqrt(4000000 / (base.width * base.height)),
      );
      const viewport = page.getViewport({ scale });
      const canvas = documentCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvasContext: canvas.getContext("2d")!,
        canvas,
        viewport,
      }).promise;
      check();
      const thumbScale = Math.min(150 / canvas.width, 200 / canvas.height);
      const thumb = documentCanvas(
        Math.max(1, Math.round(canvas.width * thumbScale)),
        Math.max(1, Math.round(canvas.height * thumbScale)),
      );
      thumb
        .getContext("2d")!
        .drawImage(canvas, 0, 0, thumb.width, thumb.height);
      const record: PageRecord = {
        index,
        number: null,
        confidence: 0,
        source: "pending",
        thumbnail: thumb.toDataURL("image/jpeg", 0.65),
      };
      if (index < settings.preserve) {
        record.source = "preserved";
        record.confidence = 100;
      } else if (saved.has(index)) {
        record.number = saved.get(index)!;
        record.source = "saved";
        record.confidence = 100;
      } else {
        const content = await page.getTextContent();
        check();
        const readings: RegionReading[] = [];
        const automatic = settings.detectionMode === "automatic";
        const textTokens = pdfTextTokens(content.items, viewport);
        const areas = automatic
          ? [{ x: 0, y: 0, width: 1, height: 1 }]
          : areasForScan(settings.scanAreas, index);
        for (let areaIndex = 0; areaIndex < areas.length; areaIndex++) {
          check();
          const selection = areas[areaIndex];
          const region = boxForCrop(selection, canvas.width, canvas.height);
          const candidates = automatic
            ? automaticCandidates(textTokens, canvas.width, canvas.height)
            : contextualCandidates(textTokens, region);
          if (
            candidates.values.length > 0 ||
            candidates.ambiguous ||
            (!automatic && candidates.blocked)
          ) {
            readings.push({ ...candidates, source: "text" });
            continue;
          }
          if (!worker) {
            onStatus("Starting local OCR engine…");
            const root = new URL(import.meta.env.BASE_URL, location.href).href;
            const initialization = createWorker("eng", OEM.LSTM_ONLY, {
              workerPath: `${root}ocr/worker.min.js`,
              corePath: `${root}ocr/core`,
              langPath: `${root}ocr/lang`,
              workerBlobURL: false,
              errorHandler: (error) =>
                rejectOperation?.(new Error(`OCR engine: ${String(error)}`)),
            });
            void initialization.then(
              (created) => {
                if (signal.aborted) void created.terminate();
              },
              () => {},
            );
            worker = await guarded(initialization);
            check();
            (worker as unknown as { worker: Worker }).worker.addEventListener(
              "error",
              (event: ErrorEvent) =>
                rejectOperation?.(
                  new Error(event.message || "OCR worker failed."),
                ),
            );
            await guarded(
              worker.setParameters({
                tessedit_pageseg_mode: automatic ? PSM.AUTO : PSM.SINGLE_BLOCK,
              }),
            );
          }
          onStatus(
            `Recognizing page ${index + 1} of ${document.numPages} · Area ${areaIndex + 1}/${areas.length}`,
          );
          const area = automatic
            ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
            : contextBand(selection, canvas.width, canvas.height);
          const crop = documentCanvas(area.width, area.height);
          crop
            .getContext("2d")!
            .drawImage(
              canvas,
              area.x,
              area.y,
              area.width,
              area.height,
              0,
              0,
              area.width,
              area.height,
            );
          try {
            const result = await guarded(
              worker.recognize(crop, {}, { text: true, blocks: true }),
            );
            check();
            readings.push({
              ...(automatic
                ? automaticCandidates(
                    [
                      ...textTokens,
                      ...ocrTokens(result.data.blocks, {
                        x: area.x,
                        y: area.y,
                      }),
                    ],
                    canvas.width,
                    canvas.height,
                  )
                : contextualCandidates(
                    [
                      ...textTokens,
                      ...ocrTokens(result.data.blocks, {
                        x: area.x,
                        y: area.y,
                      }),
                    ],
                    region,
                  )),
              source: "ocr",
            });
          } finally {
            crop.width = 0;
            crop.height = 0;
          }
        }
        Object.assign(record, aggregateReadings(readings));
      }
      canvas.width = 0;
      canvas.height = 0;
      thumb.width = 0;
      thumb.height = 0;
      page.cleanup();
      pages.push(record);
      onPage(record, document.numPages);
    }
    return pages;
  } finally {
    signal.removeEventListener("abort", abort);
    if (worker) await worker.terminate().catch(() => {});
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}
function documentCanvas(width: number, height: number) {
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
