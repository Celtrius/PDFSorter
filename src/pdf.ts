import { PDFDocument, PDFName, PDFNumber, PDFDict, PDFNull } from "pdf-lib";
import { validNumber, type PageRecord } from "./model";
const KEY = PDFName.of("FolioPageNumber");
export async function readSavedNumbers(
  bytes: Uint8Array,
): Promise<Map<number, number | null>> {
  const doc = await PDFDocument.load(bytes);
  const result = new Map<number, number | null>();
  doc.getPages().forEach((page, index) => {
    const value = page.node.get(KEY);
    if (!(value instanceof PDFDict)) return;
    const version = value.get(PDFName.of("Version"));
    const number = value.get(PDFName.of("Number"));
    if (!(version instanceof PDFNumber) || version.asNumber() !== 1) return;
    if (number instanceof PDFNumber && validNumber(number.asNumber()))
      result.set(index, number.asNumber());
  });
  return result;
}
export async function exportSortedPdf(
  bytes: Uint8Array,
  pages: PageRecord[],
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  const output = await PDFDocument.create();
  const copied = await output.copyPages(
    source,
    pages.map((p) => p.index),
  );
  copied.forEach((page, i) => {
    const number = pages[i].number;
    if (number !== null && !validNumber(number))
      throw new Error(
        "Invalid page number. Use a whole number from 0 to 999999.",
      );
    page.node.set(
      KEY,
      output.context.obj({
        Version: 1,
        Number: number === null ? PDFNull : PDFNumber.of(number),
      }),
    );
    output.addPage(page);
  });
  output.setCreator("Folio • Local PDF page sorter");
  return output.save();
}
