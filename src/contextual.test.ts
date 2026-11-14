import { describe, expect, it } from "vitest";
import {
  automaticCandidates,
  contextBand,
  contextualCandidates,
  ocrTokens,
  pdfTextTokens,
  type NumberToken,
} from "./contextual";
const token = (
  text: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  confidence = 95,
): NumberToken => ({ text, bbox: { x0, y0, x1, y1 }, confidence });
const sample = [
  token("54", 30, 40, 60, 60),
  token("Chapter", 400, 40, 500, 60),
  token("1", 510, 40, 520, 60),
  token("Obj.", 800, 40, 850, 60),
  token("6", 860, 40, 875, 60),
];
describe("contextual page number isolation", () => {
  it("finds isolated 54 without accepting Obj. 6 or Chapter 1 from the same header", () => {
    expect(
      contextualCandidates(sample, { x0: 20, y0: 30, x1: 80, y1: 70 }).values,
    ).toEqual([54]);
    expect(
      contextualCandidates(sample, { x0: 850, y0: 30, x1: 890, y1: 70 }),
    ).toMatchObject({ values: [], blocked: true });
    expect(
      contextualCandidates(sample, { x0: 500, y0: 30, x1: 530, y1: 70 }).values,
    ).toEqual([]);
  });
  it("never borrows a number outside a selected area and rejects a clipped trailing digit", () => {
    expect(
      contextualCandidates(sample, { x0: 800, y0: 30, x1: 890, y1: 70 }).values,
    ).toEqual([]);
    expect(
      contextualCandidates([token("56", 850, 40, 880, 60)], {
        x0: 870,
        y0: 30,
        x1: 890,
        y1: 70,
      }),
    ).toMatchObject({ values: [], blocked: true });
  });
  it("rejects nearby numeric fragments, punctuation and low-confidence OCR", () => {
    expect(
      contextualCandidates(
        [token("5", 10, 10, 20, 30), token("4", 23, 10, 33, 30)],
        { x0: 0, y0: 0, x1: 100, y1: 50 },
      ).values,
    ).toEqual([]);
    expect(
      contextualCandidates(
        [token("54", 10, 10, 40, 30), token(".", 45, 10, 48, 30)],
        { x0: 0, y0: 0, x1: 100, y1: 50 },
      ).values,
    ).toEqual([]);
    expect(
      contextualCandidates([token("54", 10, 10, 40, 30, 69)], {
        x0: 0,
        y0: 0,
        x1: 100,
        y1: 50,
      }).values,
    ).toEqual([]);
  });
  it("keeps full token boxes and merges overlapping text/OCR representations safely", () => {
    const duplicate = token("54", 31, 41, 59, 60, 83);
    expect(
      contextualCandidates([sample[0], duplicate], {
        x0: 20,
        y0: 30,
        x1: 80,
        y1: 70,
      }),
    ).toMatchObject({ values: [54], confidence: 83 });
  });
  it("preserves full-width neighbor context with bounded vertical padding", () => {
    expect(
      contextBand({ x: 0.8, y: 0.02, width: 0.1, height: 0.04 }, 1000, 1000),
    ).toEqual({ x: 0, y: 0, width: 1000, height: 90 });
  });
  it("extracts OCR word boxes with offsets and uses PDF text boxes for equivalent context", () => {
    const blocks = [
      { paragraphs: [{ lines: [{ words: [token("54", 20, 10, 50, 30)] }] }] },
    ];
    expect(ocrTokens(blocks, { x: 10, y: 30 })).toEqual([sample[0]]);
    expect(ocrTokens(null)).toEqual([]);
    const tokens = pdfTextTokens(
      [
        {
          str: "Obj.",
          transform: [20, 0, 0, 20, 800, 940],
          width: 50,
          height: 20,
        },
        {
          str: "6",
          transform: [20, 0, 0, 20, 860, 940],
          width: 15,
          height: 20,
        },
      ],
      { transform: [1, 0, 0, -1, 0, 1000] },
    );
    expect(
      contextualCandidates(tokens, { x0: 850, y0: 30, x1: 890, y1: 70 }).values,
    ).toEqual([]);
  });
});
describe("automatic whole-page selection", () => {
  it("prefers the isolated margin number and excludes nearby contextual numbers", () => {
    expect(automaticCandidates(sample, 1000, 1000)).toMatchObject({
      values: [54],
      ambiguous: false,
    });
  });
  it("abstains on body-only exercise numbers and insufficient confidence", () => {
    expect(
      automaticCandidates([token("6", 450, 490, 470, 510)], 1000, 1000).values,
    ).toEqual([]);
    expect(
      automaticCandidates([token("54", 30, 40, 60, 60, 79)], 1000, 1000).values,
    ).toEqual([]);
  });
  it("leaves competing strong margin numbers unresolved and deduplicates equal values", () => {
    expect(
      automaticCandidates(
        [sample[0], token("55", 30, 940, 60, 960)],
        1000,
        1000,
      ),
    ).toMatchObject({ values: [54, 55], ambiguous: true });
    expect(
      automaticCandidates(
        [sample[0], token("54", 30, 940, 60, 960)],
        1000,
        1000,
      ),
    ).toMatchObject({ values: [54], ambiguous: false });
  });
  it("searches the full page independently of a manual region or scan profile", () => {
    const manual = { x0: 800, y0: 30, x1: 890, y1: 70 };
    expect(contextualCandidates(sample, manual).values).toEqual([]);
    expect(automaticCandidates(sample, 1000, 1000).values).toEqual([54]);
  });
});
