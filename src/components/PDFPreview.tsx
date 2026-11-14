import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { pdfjs } from "../pdfjs";
import {
  cropFromDrag,
  relativePoint,
  type CropRect,
  type Point,
} from "../crop";
import { Button } from "./ui/button";
import type {
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
type Props = {
  bytes: Uint8Array;
  selections?: CropRect[];
  activeSelection?: number;
  onSelectArea?: (index: number) => void;
  onSelectionChange?: (rect: CropRect, index: number) => void;
  pageOrder?: number[];
  initialPage?: number;
  onPageChange?: (page: number) => void;
};
export default function PDFPreview({
  bytes,
  selections = [],
  activeSelection = 0,
  onSelectArea,
  onSelectionChange,
  pageOrder,
  initialPage = 0,
  onPageChange,
}: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [pageIndex, setPageIndex] = useState(initialPage),
    [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(0),
    [size, setSize] = useState({ width: 1, height: 1 }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<CropRect | null>(null);
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    start = useRef<Point | null>(null),
    dragIndex = useRef(0),
    clickedArea = useRef(-1),
    renderTask = useRef<RenderTask | null>(null),
    renderSequence = useRef(0);
  const count = pageOrder?.length ?? document?.numPages ?? 0;
  const position = Math.min(pageIndex, Math.max(0, count - 1));
  const originalIndex = pageOrder?.[position] ?? position;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setDocument(null);
    setPageIndex(initialPage);
    setZoom(1);
    start.current = null;
    setDraft(null);
    const task = pdfjs.getDocument({ data: bytes.slice() });
    void task.promise.then(
      (doc) => {
        if (live) setDocument(doc);
      },
      (reason) => {
        if (live) {
          setError(errorMessage(reason));
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
      renderSequence.current++;
      renderTask.current?.cancel();
      void task.destroy().catch(() => {});
    };
  }, [bytes, initialPage]);
  useEffect(() => {
    if (!document || !width) return;
    let live = true;
    const sequence = ++renderSequence.current;
    setLoading(true);
    setError("");
    start.current = null;
    setDraft(null);
    const previous = renderTask.current;
    previous?.cancel();
    void (async () => {
      let page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | undefined;
      try {
        if (previous) await previous.promise.catch(() => {});
        page = await document.getPage(originalIndex + 1);
        if (!live || sequence !== renderSequence.current) return;
        const base = page.getViewport({ scale: 1 });
        const fit = Math.min((width - 24) / base.width, 560 / base.height);
        const display = page.getViewport({ scale: Math.max(0.1, fit) * zoom });
        const resolution = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(6000000 / (display.width * display.height)),
        );
        const viewport = page.getViewport({
          scale: Math.max(0.1, fit) * zoom * resolution,
        });
        const target = canvas.current;
        if (!target) return;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        setSize({ width: display.width, height: display.height });
        const task = page.render({
          canvas: target,
          canvasContext: target.getContext("2d")!,
          viewport,
        });
        renderTask.current = task;
        await task.promise;
        if (live && sequence === renderSequence.current) setLoading(false);
      } catch (reason) {
        if (
          live &&
          sequence === renderSequence.current &&
          !(
            reason instanceof Error &&
            reason.name === "RenderingCancelledException"
          )
        ) {
          setError(errorMessage(reason));
          setLoading(false);
        }
      } finally {
        page?.cleanup();
      }
    })();
    return () => {
      live = false;
      renderSequence.current++;
      renderTask.current?.cancel();
    };
  }, [document, width, zoom, originalIndex]);
  function navigate(index: number) {
    setPageIndex(index);
    setDraft(null);
    onPageChange?.(index);
  }
  function point(event: PointerEvent<HTMLDivElement>) {
    return relativePoint(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (!start.current || !event.isPrimary) return;
    const end = point(event),
      bounds = event.currentTarget.getBoundingClientRect();
    const moved =
      Math.hypot(
        (end.x - start.current.x) * bounds.width,
        (end.y - start.current.y) * bounds.height,
      ) >= 4;
    if (moved)
      onSelectionChange?.(cropFromDrag(start.current, end), dragIndex.current);
    else if (clickedArea.current >= 0) onSelectArea?.(clickedArea.current);
    start.current = null;
    setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <div className="min-w-0" aria-label="PDF preview">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Previous preview page"
            disabled={!document || position === 0}
            onClick={() => navigate(position - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <span aria-live="polite">
            {count ? `${position + 1} / ${count}` : "Loading PDF…"}
            {pageOrder && count ? ` · Scan ${originalIndex + 1}` : ""}
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Next preview page"
            disabled={!document || position + 1 >= count}
            onClick={() => navigate(position + 1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Zoom out"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          >
            <Minus size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>
            Fit
          </Button>
          <span className="w-9 text-center">{Math.round(zoom * 100)}%</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Zoom in"
            disabled={zoom >= 3}
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>
      <div
        ref={host}
        className="relative max-h-[65dvh] min-h-40 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3"
        aria-busy={loading}
      >
        <>
          <div
            style={{
              width: Math.max(size.width, width - 26),
              minHeight: size.height,
            }}
            className="flex justify-center"
          >
            <div
              className={`relative shrink-0 ${onSelectionChange ? "touch-none cursor-crosshair" : ""}`}
              style={{
                width: size.width,
                height: size.height,
                visibility: loading || error ? "hidden" : "visible",
              }}
              role={onSelectionChange ? "group" : undefined}
              aria-label={
                onSelectionChange ? "Drag to select scan area" : undefined
              }
              onPointerDown={(event) => {
                if (
                  !onSelectionChange ||
                  event.button !== 0 ||
                  !event.isPrimary
                )
                  return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                start.current = point(event);
                dragIndex.current = activeSelection;
                clickedArea.current = selections.reduce(
                  (hit, area, index) =>
                    start.current!.x >= area.x &&
                    start.current!.x <= area.x + area.width &&
                    start.current!.y >= area.y &&
                    start.current!.y <= area.y + area.height
                      ? index
                      : hit,
                  -1,
                );
                setDraft(null);
              }}
              onPointerMove={(event) => {
                if (start.current && event.isPrimary) {
                  const end = point(event),
                    bounds = event.currentTarget.getBoundingClientRect();
                  if (
                    Math.hypot(
                      (end.x - start.current.x) * bounds.width,
                      (end.y - start.current.y) * bounds.height,
                    ) >= 4
                  )
                    setDraft(cropFromDrag(start.current, end));
                }
              }}
              onPointerUp={finish}
              onPointerCancel={() => {
                start.current = null;
                setDraft(null);
              }}
              onLostPointerCapture={() => {
                start.current = null;
                setDraft(null);
              }}
            >
              <canvas
                ref={canvas}
                role="img"
                aria-label={`PDF scan ${originalIndex + 1}`}
                style={{ width: size.width, height: size.height }}
              />
              {selections.map((stored, index) => {
                const area =
                  draft && index === dragIndex.current ? draft : stored;
                const active = index === activeSelection;
                return (
                  <div
                    key={index}
                    className={`pointer-events-none absolute ${active ? "border-2 border-emerald-400 bg-emerald-400/15" : "border border-sky-500/80 bg-sky-500/5"}`}
                    style={{
                      left: `${area.x * 100}%`,
                      top: `${area.y * 100}%`,
                      width: `${area.width * 100}%`,
                      height: `${area.height * 100}%`,
                    }}
                  >
                    <span
                      className={`absolute left-0 top-0 px-1 text-[10px] leading-4 ${active ? "bg-emerald-900 text-emerald-100" : "bg-zinc-900 text-zinc-200"}`}
                    >
                      {index + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {loading && (
            <p
              role="status"
              className="absolute inset-x-0 top-12 text-center text-sm text-zinc-400"
            >
              Rendering page…
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="absolute inset-x-0 top-12 px-4 text-center text-sm text-red-300"
            >
              {error}
            </p>
          )}
        </>
      </div>
    </div>
  );
}
function errorMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : "Could not preview this PDF.";
}
