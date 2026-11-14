import { expect, it } from "vitest";
import { PDFDocument, PDFName, PDFNumber, StandardFonts } from "pdf-lib";
import { exportSortedPdf, readSavedNumbers } from "./pdf";
import { sortedPages, type PageRecord } from "./model";
it("copies real PDF page objects in order, keeps page size/content, and round-trips invisible metadata", async () => {
  const original = await PDFDocument.create();
  const font = await original.embedFont(StandardFonts.Helvetica);
  [10, 2, 1].forEach((number, i) => {
    const p = original.addPage([400 + i * 10, 600]);
    p.drawText(`Book page ${number}`, { font, size: 24, x: 20, y: 30 });
  });
  const source = await original.save();
  const records: PageRecord[] = [10, 2, 1].map((number, index) => ({
    index,
    number,
    confidence: 100,
    source: "manual",
    thumbnail: "",
  }));
  const result = await exportSortedPdf(source, sortedPages(records, 0));
  const doc = await PDFDocument.load(result);
  expect(doc.getPageCount()).toBe(3);
  expect(doc.getPages().map((p) => p.getWidth())).toEqual([420, 410, 400]);
  expect([...(await readSavedNumbers(result))]).toEqual([
    [0, 1],
    [1, 2],
    [2, 10],
  ]);
  expect(doc.getPage(0).node.Contents()).toBeDefined();
});
it("ignores unknown metadata versions and retries unnumbered pages", async () => {
  const source = await PDFDocument.create();
  source.addPage();
  source.addPage();
  const bytes = await source.save();
  const pages: PageRecord[] = [
    { index: 0, number: null, confidence: 0, source: "ocr", thumbnail: "" },
    { index: 1, number: 2, confidence: 100, source: "manual", thumbnail: "" },
  ];
  const result = await exportSortedPdf(bytes, pages);
  expect([...(await readSavedNumbers(result))]).toEqual([[1, 2]]);
  const edited = await PDFDocument.load(result);
  edited
    .getPage(1)
    .node.set(
      PDFName.of("FolioPageNumber"),
      edited.context.obj({ Version: PDFNumber.of(999), Number: 2 }),
    );
  expect((await readSavedNumbers(await edited.save())).size).toBe(0);
});
it("rejects malformed editable numbers at export", async () => {
  const source = await PDFDocument.create();
  source.addPage();
  await expect(
    exportSortedPdf(await source.save(), [
      {
        index: 0,
        number: -1,
        confidence: 100,
        source: "manual",
        thumbnail: "",
      },
    ]),
  ).rejects.toThrow("Invalid page number");
});
