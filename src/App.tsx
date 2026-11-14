import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { inspectPages, sortedPages, type PageRecord } from "./model";
import type { Settings } from "./process";
import { DEFAULT_CROP, type CropRect } from "./crop";
import {
  areasForProfile,
  createScanAreas,
  editScanArea,
  MAX_SCAN_AREAS,
  profileForScan,
  replaceProfileAreas,
  setScanMode,
  type ScanProfile,
  type ScanAreas,
} from "./scan-areas";
const PDFPreview = lazy(() => import("./components/PDFPreview"));

const PER_PAGE = 24;
export default function App() {
  const [file, setFile] = useState<File | null>(null),
    [bytes, setBytes] = useState<Uint8Array | null>(null),
    [pages, setPages] = useState<PageRecord[]>([]),
    [settings, setSettings] = useState<Settings>({
      preserve: 0,
      detectionMode: "automatic",
      scanAreas: createScanAreas(),
      force: false,
    }),
    [phase, setPhase] = useState<"upload" | "ready" | "processing" | "review">(
      "upload",
    ),
    [status, setStatus] = useState(""),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [drag, setDrag] = useState(false),
    [filter, setFilter] = useState("all"),
    [pageIndex, setPageIndex] = useState(0),
    [preview, setPreview] = useState(false),
    [inspectAt, setInspectAt] = useState<number | null>(null),
    [setupPage, setSetupPage] = useState(0),
    [selectedAreas, setSelectedAreas] = useState<Record<ScanProfile, number>>({
      shared: 0,
      odd: 0,
      even: 0,
    }),
    [exporting, setExporting] = useState(false),
    [invalid, setInvalid] = useState<Set<number>>(new Set()),
    [attentionIds, setAttentionIds] = useState<Set<number>>(new Set());
  const input = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      controller.current?.abort();
      generation.current++;
    },
    [],
  );
  const stats = useMemo(
    () => inspectPages(pages, settings.preserve),
    [pages, settings.preserve],
  );
  const ordered = useMemo(
    () => sortedPages(pages, settings.preserve),
    [pages, settings.preserve],
  );
  const visible = pages.filter(
    (p) => filter === "all" || attentionIds.has(p.index),
  );
  const batch = visible.slice(pageIndex * PER_PAGE, (pageIndex + 1) * PER_PAGE);
  const activeProfile = profileForScan(settings.scanAreas, setupPage);
  const activeAreas = areasForProfile(settings.scanAreas, activeProfile);
  const selectedAreaIndex = Math.min(
    selectedAreas[activeProfile],
    activeAreas.length - 1,
  );
  const selectedArea = activeAreas[selectedAreaIndex];
  function selectArea(index: number) {
    setSelectedAreas((previous) => ({ ...previous, [activeProfile]: index }));
  }
  function replaceAreas(areas: CropRect[], index = 0) {
    setSettings((previous) => ({
      ...previous,
      scanAreas: replaceProfileAreas(previous.scanAreas, activeProfile, areas),
    }));
    selectArea(index);
  }

  async function selectFile(selected: File | undefined) {
    if (!selected) return;
    const id = ++generation.current;
    controller.current?.abort();
    setPages([]);
    setSetupPage(0);
    setInvalid(new Set());
    setError("");
    setPhase("upload");
    setFile(null);
    setBytes(null);
    if (
      selected.type !== "application/pdf" &&
      !selected.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Choose a PDF file to get started.");
      return;
    }
    try {
      const data = new Uint8Array(await selected.arrayBuffer());
      if (id !== generation.current) return;
      if (!new TextDecoder().decode(data.slice(0, 1024)).includes("%PDF-"))
        throw new Error("This file does not appear to be a valid PDF.");
      setFile(selected);
      setBytes(data);
      setPhase("ready");
    } catch (e) {
      if (id === generation.current) setError(message(e));
    }
  }
  async function analyze() {
    if (!bytes) return;
    const id = ++generation.current;
    const current = new AbortController();
    controller.current = current;
    setPages([]);
    setInvalid(new Set());
    setError("");
    setTotal(0);
    setSetupPage(0);
    setPhase("processing");
    setPageIndex(0);
    setFilter("all");
    try {
      const { processPdf } = await import("./process");
      await processPdf(
        bytes,
        settings,
        current.signal,
        (record, count) => {
          if (id === generation.current) {
            setTotal(count);
            setPages((prev) => [...prev, record]);
          }
        },
        (text) => {
          if (id === generation.current) setStatus(text);
        },
      );
      if (id === generation.current) setPhase("review");
    } catch (e) {
      if (id !== generation.current) return;
      setPages([]);
      setPhase("ready");
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(message(e));
    } finally {
      if (id === generation.current) controller.current = null;
    }
  }
  function cancel() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setPages([]);
    setPhase("ready");
    setStatus("");
  }
  function updateNumber(index: number, value: string) {
    const valid = value === "" || /^\d{1,6}$/.test(value);
    setInvalid((previous) => {
      const next = new Set(previous);
      if (valid) next.delete(index);
      else next.add(index);
      return next;
    });
    if (valid)
      setPages((previous) =>
        previous.map((p) =>
          p.index === index
            ? {
                ...p,
                number: value === "" ? null : Number(value),
                confidence: 100,
                source: "manual",
                conflict: false,
              }
            : p,
        ),
      );
  }
  async function download() {
    if (!bytes || invalid.size) return;
    setExporting(true);
    setError("");
    try {
      const { exportSortedPdf } = await import("./pdf");
      const result = await exportSortedPdf(bytes, ordered);
      const url = URL.createObjectURL(
        new Blob([result as BlobPart], { type: "application/pdf" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${file?.name.replace(/\.pdf$/i, "") ?? "book"}-sorted.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      setError(message(e));
    } finally {
      setExporting(false);
    }
  }
  function pagination(count: number) {
    return (
      <div className="flex items-center justify-between border-t border-zinc-800 pt-5 text-sm text-zinc-400">
        <span>
          {count === 0
            ? "No pages to show"
            : `${pageIndex * PER_PAGE + 1}–${Math.min((pageIndex + 1) * PER_PAGE, count)} of ${count} pages`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous pages"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((p) => p - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next pages"
            disabled={(pageIndex + 1) * PER_PAGE >= count}
            onClick={() => setPageIndex((p) => p + 1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <main
        aria-label="PDF page sorter"
        className="mx-auto my-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8"
      >
        {error && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300"
          >
            {error}
          </div>
        )}
        {(phase === "upload" || phase === "ready") && (
          <div className="grid items-start gap-6 md:grid-cols-[1fr_300px]">
            <section aria-label="Upload PDF file" className="min-w-0">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  void selectFile(e.dataTransfer.files[0]);
                }}
                className={`flex items-center justify-center rounded-lg border border-dashed text-center transition-colors ${bytes ? "mb-3 flex-wrap gap-3 px-3 py-2" : "min-h-72 flex-col p-6"} ${drag ? "border-emerald-600 bg-emerald-950/50" : "border-zinc-700 bg-zinc-900/50"}`}
              >
                {!bytes && <Upload size={24} className="mb-4 text-zinc-400" />}
                <p className="min-w-0 max-w-full break-all text-xs">
                  {file ? file.name : "Drop your PDF here"}
                </p>
                <p
                  className={
                    bytes
                      ? "text-xs text-zinc-400"
                      : "mb-5 mt-2 text-xs text-zinc-400"
                  }
                >
                  {file
                    ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                    : "PDF"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => input.current?.click()}
                >
                  {file ? "Choose another PDF" : "Browse files"}
                  <ArrowRight size={14} />
                </Button>
                <input
                  ref={input}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  aria-label="Upload PDF"
                  onChange={(e) => {
                    void selectFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              {bytes && (
                <Suspense
                  fallback={
                    <p
                      role="status"
                      className="py-8 text-center text-sm text-zinc-400"
                    >
                      Loading preview…
                    </p>
                  }
                >
                  <PDFPreview
                    bytes={bytes}
                    selections={
                      settings.detectionMode === "areas" ? activeAreas : []
                    }
                    activeSelection={selectedAreaIndex}
                    onSelectArea={selectArea}
                    onPageChange={setSetupPage}
                    onSelectionChange={
                      settings.detectionMode === "areas"
                        ? (selection, index) =>
                            setSettings((previous) => ({
                              ...previous,
                              scanAreas: editScanArea(
                                previous.scanAreas,
                                activeProfile,
                                index,
                                selection,
                              ),
                            }))
                        : undefined
                    }
                  />
                </Suspense>
              )}
            </section>
            <section aria-label="Recognition settings" className="min-w-0">
              <label className="field-label" htmlFor="detection-mode">
                Detection
              </label>
              <select
                id="detection-mode"
                value={settings.detectionMode}
                onChange={(event) =>
                  setSettings((previous) => ({
                    ...previous,
                    detectionMode: event.target
                      .value as Settings["detectionMode"],
                  }))
                }
              >
                <option value="automatic">Automatic</option>
                <option value="areas">Select areas</option>
              </select>
              {settings.detectionMode === "automatic" ? (
                <p className="mt-3 text-xs leading-5 text-zinc-400">
                  Search the whole page; uncertain results need review.
                </p>
              ) : (
                <div className="mt-4">
                  <label className="field-label" htmlFor="area-mode">
                    Scan areas
                  </label>
                  <select
                    id="area-mode"
                    value={settings.scanAreas.mode}
                    onChange={(event) =>
                      setSettings((previous) => ({
                        ...previous,
                        scanAreas: setScanMode(
                          previous.scanAreas,
                          event.target.value as ScanAreas["mode"],
                        ),
                      }))
                    }
                  >
                    <option value="all">All scans</option>
                    <option value="alternating">Odd/even scans</option>
                  </select>
                  <p
                    id="scan-help"
                    className="my-3 text-xs leading-5 text-zinc-400"
                  >
                    Add areas for different number positions. For shuffled
                    pages, use All scans.
                    {settings.scanAreas.mode === "alternating" &&
                      " Odd/even follows original scan order, not printed numbers."}
                  </p>
                  {settings.scanAreas.mode === "alternating" && (
                    <p className="mb-3 text-xs text-emerald-300" role="status">
                      Editing{" "}
                      {activeProfile === "odd"
                        ? "scans 1, 3, 5…"
                        : "scans 2, 4, 6…"}{" "}
                      · follows preview page
                    </p>
                  )}
                  <div
                    className="mb-2 flex flex-wrap gap-1"
                    role="group"
                    aria-label="Select scan area"
                  >
                    {activeAreas.map((_, index) => (
                      <Button
                        key={index}
                        variant={
                          selectedAreaIndex === index ? "default" : "outline"
                        }
                        size="sm"
                        aria-pressed={selectedAreaIndex === index}
                        onClick={() => selectArea(index)}
                      >
                        Area {index + 1}
                      </Button>
                    ))}
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={activeAreas.length >= MAX_SCAN_AREAS}
                      onClick={() =>
                        replaceAreas(
                          [
                            ...activeAreas,
                            { x: 0.05, y: 0.05, width: 0.25, height: 0.1 },
                          ],
                          activeAreas.length,
                        )
                      }
                    >
                      Add area
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={activeAreas.length <= 1}
                      onClick={() =>
                        replaceAreas(
                          activeAreas.filter(
                            (_, index) => index !== selectedAreaIndex,
                          ),
                          Math.min(selectedAreaIndex, activeAreas.length - 2),
                        )
                      }
                    >
                      Remove
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => replaceAreas([{ ...DEFAULT_CROP }])}
                    >
                      Reset
                    </Button>
                  </div>
                  <p className="mb-3 text-[11px] leading-5 text-zinc-400">
                    Drag to redraw the selected area, or enter percentages.
                    Click an area to select it.
                  </p>
                  <div
                    className="grid grid-cols-2 gap-3"
                    role="group"
                    aria-label="Scan rectangle percentages"
                    aria-describedby="scan-help"
                  >
                    {(
                      [
                        ["x", "Left"],
                        ["y", "Top"],
                        ["width", "Width"],
                        ["height", "Height"],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field} className="text-xs text-zinc-400">
                        {label} %
                        <input
                          aria-label={`${label} percent`}
                          className="mt-1"
                          type="number"
                          min={field === "width" || field === "height" ? 1 : 0}
                          max="100"
                          step="1"
                          value={Math.round(selectedArea[field] * 10000) / 100}
                          onChange={(event) =>
                            setSettings((previous) => ({
                              ...previous,
                              scanAreas: editScanArea(
                                previous.scanAreas,
                                activeProfile,
                                selectedAreaIndex,
                                {
                                  ...selectedArea,
                                  [field]: Number(event.target.value) / 100,
                                } as CropRect,
                              ),
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label className="field-label mt-5" htmlFor="preserve">
                Keep first pages in place
              </label>
              <input
                id="preserve"
                type="number"
                min="0"
                max="9999"
                value={settings.preserve}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    preserve: Math.min(
                      9999,
                      Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    ),
                  })
                }
              />
              <p className="mt-2 text-[11px] leading-5 text-zinc-400">
                Skip OCR and keep these opening pages at the front.
              </p>
              <label className="mt-5 flex cursor-pointer items-start gap-2 text-xs leading-5 text-zinc-300">
                <input
                  type="checkbox"
                  checked={settings.force}
                  onChange={(e) =>
                    setSettings({ ...settings, force: e.target.checked })
                  }
                  className="mt-1 accent-emerald-600"
                />{" "}
                Recheck saved numbers
              </label>
              <Button
                className="mt-6 w-full"
                disabled={!bytes}
                onClick={() => void analyze()}
              >
                <ScanLine size={16} />
                Recognize pages
                <ArrowRight size={15} />
              </Button>
            </section>
          </div>
        )}
        {phase === "processing" && (
          <section
            aria-label="Recognition progress"
            className="mx-auto max-w-md py-12"
          >
            <p
              className="text-sm text-zinc-400"
              role="status"
              aria-live="polite"
            >
              {status || "Opening your PDF…"}
            </p>
            <div className="mt-5">
              <div
                role="progressbar"
                aria-label="Pages recognized"
                aria-valuemin={0}
                aria-valuemax={total || 100}
                aria-valuenow={pages.length}
                className="h-2 overflow-hidden rounded-full bg-zinc-800"
              >
                <div
                  className="h-full rounded-full bg-emerald-800 transition-all"
                  style={{
                    width: `${total ? (pages.length / total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                {pages.length} of {total || "…"} pages · Keep this tab open
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-5"
              onClick={cancel}
            >
              <X size={14} />
              Cancel recognition
            </Button>
          </section>
        )}
        {phase === "review" && (
          <section aria-label="Review pages">
            <div className="mb-5 flex flex-wrap items-center justify-end gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPreview(true);
                    setPageIndex(0);
                  }}
                >
                  Preview order
                </Button>
                <Button
                  disabled={exporting || invalid.size > 0}
                  onClick={() => void download()}
                >
                  {exporting ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <ArrowDownToLine size={16} />
                  )}
                  Save sorted PDF
                </Button>
              </div>
            </div>
            <div className="mb-5 flex flex-wrap gap-x-6 gap-y-3 border-y border-zinc-800 py-4">
              {[
                [pages.length, "Total pages"],
                [stats.unnumbered, "Without a number"],
                [stats.duplicates.size, "Duplicate numbers"],
                [stats.low, "Low confidence"],
              ].map(([count, label]) => (
                <div key={label} className="flex items-baseline gap-2">
                  <p className="text-sm font-medium">{count}</p>
                  <p className="text-xs text-zinc-400">{label}</p>
                </div>
              ))}
            </div>
            <div className="mb-5 text-xs leading-6 text-zinc-400">
              {settings.preserve > 0 &&
                `${Math.min(settings.preserve, pages.length)} opening pages stay at the front. `}
              Numbers sort ascending. Ties keep scan order. Unnumbered pages go
              last.
              {stats.missingCount > 0 && (
                <p>
                  <strong>Gaps in the sequence:</strong>{" "}
                  {stats.missing.join(", ")}
                  {stats.missingCount > 100
                    ? ` … (${stats.missingCount} total)`
                    : ""}
                  . No pages are added.
                </p>
              )}
            </div>
            {invalid.size > 0 && (
              <p role="alert" className="mb-4 text-sm text-red-300">
                Enter 0–999999 or leave blank. Fix highlighted fields to export.
              </p>
            )}
            <div className="mb-5 flex items-center justify-between">
              <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
                {[
                  ["all", "All pages"],
                  ["attention", "Needs attention"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => {
                      setFilter(value);
                      setAttentionIds(
                        new Set(
                          pages
                            .filter(
                              (p) =>
                                p.index >= settings.preserve &&
                                (p.number === null ||
                                  p.confidence < 80 ||
                                  stats.duplicates.has(p.number)),
                            )
                            .map((p) => p.index),
                        ),
                      );
                      setPageIndex(0);
                    }}
                    className={`rounded-md px-3 py-2 text-xs ${filter === value ? "bg-zinc-800 font-semibold" : "text-zinc-400"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhase("ready");
                  setSetupPage(0);
                  setPageIndex(0);
                }}
              >
                Change settings
              </Button>
            </div>
            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {batch.map((p) => (
                <article
                  key={p.index}
                  className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
                >
                  <button
                    type="button"
                    aria-label={`Open scan ${p.index + 1} preview`}
                    onClick={() => setInspectAt(p.index)}
                    className="relative flex h-44 w-full items-center justify-center bg-zinc-800 p-3"
                  >
                    <img
                      src={p.thumbnail}
                      alt={`Original PDF page ${p.index + 1}`}
                      className="max-h-full max-w-full shadow-md"
                    />
                    <span className="absolute left-2 top-2 rounded bg-zinc-900/95 px-2 py-1 text-[10px] text-zinc-400">
                      Scan {p.index + 1}
                    </span>
                  </button>
                  <div className="p-3">
                    <label
                      htmlFor={`number-${p.index}`}
                      className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-zinc-400"
                    >
                      Printed number
                    </label>
                    {p.index < settings.preserve ? (
                      <p className="flex h-9 items-center gap-1 text-xs text-emerald-300">
                        <LockKeyhole size={12} />
                        Kept at front
                      </p>
                    ) : (
                      <input
                        id={`number-${p.index}`}
                        type="text"
                        inputMode="numeric"
                        defaultValue={p.number ?? ""}
                        placeholder="—"
                        aria-invalid={invalid.has(p.index)}
                        className={invalid.has(p.index) ? "border-red-500" : ""}
                        onChange={(e) => updateNumber(p.index, e.target.value)}
                      />
                    )}
                    <p
                      className={`mt-2 min-h-4 text-[10px] ${p.number !== null && stats.duplicates.has(p.number) ? "text-amber-300" : p.number === null && p.source !== "preserved" ? "text-zinc-400" : p.confidence < 80 ? "text-amber-300" : "text-emerald-300"}`}
                    >
                      {p.conflict
                        ? "Conflicting numbers · check"
                        : p.source === "preserved"
                          ? "Recognition skipped"
                          : p.number === null
                            ? "Unnumbered · sort last"
                            : stats.duplicates.has(p.number)
                              ? "Duplicate · check number"
                              : p.source === "manual"
                                ? "Edited by you"
                                : p.source === "saved"
                                  ? "Saved number"
                                  : p.confidence < 80
                                    ? `${Math.round(p.confidence)}% confidence · check`
                                    : "✓ Number found"}
                    </p>
                  </div>
                </article>
              ))}
            </div>
            {pagination(visible.length)}
          </section>
        )}
      </main>
      <Dialog
        open={inspectAt !== null}
        onOpenChange={(open) => {
          if (!open) setInspectAt(null);
        }}
        title="PDF preview"
        description="Original scans. Use page controls to inspect the full page."
      >
        {bytes && inspectAt !== null && (
          <Suspense fallback={<p role="status">Loading preview…</p>}>
            <PDFPreview key={inspectAt} bytes={bytes} initialPage={inspectAt} />
          </Suspense>
        )}
      </Dialog>
      <Dialog
        open={preview}
        onOpenChange={(open) => {
          setPreview(open);
          setPageIndex(0);
        }}
        title="Page order"
        description="Opening pages, numbered pages, then unnumbered scans."
      >
        <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {ordered
            .slice(pageIndex * PER_PAGE, (pageIndex + 1) * PER_PAGE)
            .map((p, i) => (
              <div
                key={p.index}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center"
              >
                <button
                  type="button"
                  aria-label={`Open scan ${p.index + 1} preview`}
                  className="w-full"
                  onClick={() => {
                    setPreview(false);
                    setInspectAt(p.index);
                  }}
                >
                  <img
                    src={p.thumbnail}
                    alt={`Scan ${p.index + 1}`}
                    className="mx-auto h-28 max-w-full object-contain"
                  />
                </button>
                <p className="mt-3 text-xs font-semibold">
                  {p.index < settings.preserve
                    ? "Opening page"
                    : (p.number ?? "Unnumbered")}
                </p>
                <p className="mt-1 text-[10px] text-zinc-400">
                  Position {pageIndex * PER_PAGE + i + 1} · Scan {p.index + 1}
                </p>
              </div>
            ))}
        </div>
        {pagination(ordered.length)}
      </Dialog>
    </div>
  );
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please choose your PDF and try again.";
}
