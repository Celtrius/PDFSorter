import { describe, expect, it } from "vitest";
import {
  inspectPages,
  parsePrintedNumber,
  sortedPages,
  type PageRecord,
} from "./model";
const page = (index: number, number: number | null): PageRecord => ({
  index,
  number,
  source: "ocr",
  confidence: 95,
  thumbnail: "",
});
describe("book page ordering", () => {
  it("sorts numerically, preserves opening pages, stabilizes duplicates and unnumbered scans", () => {
    const pages = [
      page(0, 99),
      page(1, 10),
      page(2, null),
      page(3, 2),
      page(4, 2),
      page(5, null),
      page(6, 1),
    ];
    expect(sortedPages(pages, 1).map((p) => p.index)).toEqual([
      0, 6, 3, 4, 1, 2, 5,
    ]);
    expect(pages.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it("reports internal sequence gaps, duplicates, and excludes opening pages", () => {
    const pages = [
      page(0, 7),
      page(1, 2),
      page(2, 5),
      page(3, 5),
      { ...page(4, 6), confidence: 35 },
      page(5, null),
    ];
    const stats = inspectPages(pages, 1);
    expect(stats.missing).toEqual([3, 4]);
    expect([...stats.duplicates]).toEqual([5]);
    expect(stats.low).toBe(1);
    expect(stats.unnumbered).toBe(1);
  });
  it("bounds gap reporting for large erroneous numbers", () => {
    const stats = inspectPages([page(0, 1), page(1, 999999)], 0);
    expect(stats.missingCount).toBe(999997);
    expect(stats.missing.length).toBe(100);
  });
  it("accepts a single standalone Arabic number and rejects ambiguity", () => {
    expect(parsePrintedNumber(" — 123 — ")).toBe(123);
    expect(parsePrintedNumber("12\n13")).toBeNull();
    expect(parsePrintedNumber("chapter 12")).toBeNull();
    expect(parsePrintedNumber("iv")).toBeNull();
    expect(parsePrintedNumber("")).toBeNull();
  });
});
