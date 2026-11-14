import { describe, expect, it } from "vitest";
import {
  aggregateReadings,
  printedCandidates,
  type RegionReading,
} from "./recognition";
const reading = (
  text: string,
  confidence = 95,
  source: "text" | "ocr" = "text",
): RegionReading => ({ ...printedCandidates(text), confidence, source });
describe("multiple candidate areas", () => {
  it("does not interpret numbers inside prose as standalone", () => {
    expect(printedCandidates("chapter 12\nObj. 6\n12 apples").values).toEqual(
      [],
    );
  });
  it("deduplicates the same number across overlapping regions with conservative confidence", () => {
    expect(
      aggregateReadings([
        reading("54"),
        reading("54", 82, "ocr"),
        reading("", 0, "ocr"),
      ]),
    ).toEqual({ number: 54, confidence: 82, source: "ocr", conflict: false });
    expect(printedCandidates("54\n54")).toEqual({
      values: [54],
      ambiguous: false,
    });
  });
  it("rejects conflicts across areas and ambiguity inside a single text area", () => {
    expect(aggregateReadings([reading("54"), reading("55")])).toMatchObject({
      number: null,
      conflict: true,
      confidence: 0,
    });
    const ambiguous = reading("54\n55");
    expect(ambiguous.ambiguous).toBe(true);
    expect(
      aggregateReadings([ambiguous, reading("54", 100, "ocr")]),
    ).toMatchObject({ number: null, conflict: true });
  });
  it("distinguishes no number from a conflict and sanitizes confidence", () => {
    expect(aggregateReadings([reading("")])).toMatchObject({
      number: null,
      conflict: false,
    });
    expect(aggregateReadings([reading("54", NaN)])).toMatchObject({
      number: 54,
      confidence: 0,
    });
  });
});
