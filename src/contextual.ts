import { normalizeCrop, pixelCrop, type CropRect } from "./crop";
import { validNumber } from "./model";
import type { PrintedCandidates } from "./recognition";
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type NumberToken = { text: string; bbox: Box; confidence: number };
type OCRBlocks =
  | readonly {
      paragraphs: readonly {
        lines: readonly { words: readonly NumberToken[] }[];
      }[];
    }[]
  | null;
const numeric = /^[-–—.]*\d{1,6}[-–—.]*$/;
const intersects = (a: Box, b: Box) =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const contained = (a: Box, b: Box) =>
  a.x0 >= b.x0 - 1 && a.y0 >= b.y0 - 1 && a.x1 <= b.x1 + 1 && a.y1 <= b.y1 + 1;
const validBox = (box: Box) =>
  [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) &&
  box.x1 > box.x0 &&
  box.y1 > box.y0;
function duplicate(a: NumberToken, b: NumberToken) {
  const aa = a.bbox,
    bb = b.bbox;
  const intersection =
    Math.max(0, Math.min(aa.x1, bb.x1) - Math.max(aa.x0, bb.x0)) *
    Math.max(0, Math.min(aa.y1, bb.y1) - Math.max(aa.y0, bb.y0));
  return (
    a.text.trim() === b.text.trim() &&
    intersection /
      Math.min(
        (aa.x1 - aa.x0) * (aa.y1 - aa.y0),
        (bb.x1 - bb.x0) * (bb.y1 - bb.y0),
      ) >
      0.6
  );
}
function adjacent(a: NumberToken, b: NumberToken) {
  if (duplicate(a, b)) return false;
  const x = a.bbox,
    y = b.bbox;
  const height = Math.max(x.y1 - x.y0, y.y1 - y.y0);
  const sameBaseline =
    Math.abs((x.y0 + x.y1 - y.y0 - y.y1) / 2) <= height * 0.5;
  const gap = Math.max(y.x0 - x.x1, x.x0 - y.x1, 0);
  return sameBaseline && gap <= height * 2;
}
export function boxForCrop(crop: CropRect, width: number, height: number): Box {
  const area = pixelCrop(crop, width, height);
  return {
    x0: area.x,
    y0: area.y,
    x1: area.x + area.width,
    y1: area.y + area.height,
  };
}
export function contextualCandidates(
  tokens: NumberToken[],
  region: Box,
  minimumConfidence = 70,
): PrintedCandidates & {
  confidence: number;
  blocked: boolean;
  accepted: NumberToken[];
} {
  const safe = tokens.filter(
    (token) => token.text.trim() && validBox(token.bbox),
  );
  let blocked = false;
  const accepted = safe.filter((token) => {
    const text = token.text.trim();
    if (!intersects(token.bbox, region)) return false;
    if (!numeric.test(text)) {
      if (/\d/.test(text)) blocked = true;
      return false;
    }
    const number = Number(text.replace(/\D/g, ""));
    if (!validNumber(number)) return false;
    if (
      !contained(token.bbox, region) ||
      !Number.isFinite(token.confidence) ||
      token.confidence < minimumConfidence ||
      safe.some((other) => other !== token && adjacent(token, other))
    ) {
      blocked = true;
      return false;
    }
    return true;
  });
  const values = [
    ...new Set(accepted.map((token) => Number(token.text.replace(/\D/g, "")))),
  ];
  return {
    values,
    ambiguous: values.length > 1,
    confidence: accepted.length
      ? Math.min(...accepted.map((token) => Math.min(100, token.confidence)))
      : 0,
    blocked,
    accepted,
  };
}
export function automaticCandidates(
  tokens: NumberToken[],
  width: number,
  height: number,
) {
  const isolated = contextualCandidates(
    tokens,
    { x0: 0, y0: 0, x1: width, y1: height },
    80,
  );
  const ranked = isolated.accepted
    .map((token) => {
      const x = (token.bbox.x0 + token.bbox.x1) / (2 * width),
        y = (token.bbox.y0 + token.bbox.y1) / (2 * height);
      const margin = y <= 0.15 || y >= 0.85 || x <= 0.08 || x >= 0.92;
      const depth = Math.max(
        0,
        1 - Math.min(y, 1 - y) / 0.15,
        1 - Math.min(x, 1 - x) / 0.08,
      );
      return {
        token,
        score: margin
          ? 0.7 + depth * 0.2 + (Math.min(100, token.confidence) / 100) * 0.1
          : 0,
      };
    })
    .filter((candidate) => candidate.score >= 0.7)
    .sort((a, b) => b.score - a.score);
  const values = [
    ...new Set(
      ranked.map(({ token }) => Number(token.text.replace(/\D/g, ""))),
    ),
  ];
  return {
    values,
    ambiguous: values.length > 1,
    confidence: ranked.length
      ? Math.min(...ranked.map(({ token }) => Math.min(100, token.confidence)))
      : 0,
    blocked: isolated.blocked,
    ranked,
  };
}
export function contextBand(crop: CropRect, width: number, height: number) {
  const area = pixelCrop(normalizeCrop(crop), width, height);
  const padding = Math.max(12, Math.round(height * 0.03));
  const y = Math.max(0, area.y - padding);
  return {
    x: 0,
    y,
    width,
    height: Math.min(height, area.y + area.height + padding) - y,
  };
}
export function ocrTokens(
  blocks: OCRBlocks,
  offset = { x: 0, y: 0 },
): NumberToken[] {
  return (blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.flatMap((line) =>
        line.words.map((word) => ({
          text: word.text,
          confidence: word.confidence,
          bbox: {
            x0: word.bbox.x0 + offset.x,
            y0: word.bbox.y0 + offset.y,
            x1: word.bbox.x1 + offset.x,
            y1: word.bbox.y1 + offset.y,
          },
        })),
      ),
    ),
  );
}
export function pdfTextTokens(
  items: readonly (
    { str: string; transform: number[]; width: number; height: number } | object
  )[],
  viewport: { transform: number[] },
): NumberToken[] {
  return items.flatMap((item) => {
    if (
      !("str" in item) ||
      !("transform" in item) ||
      !("width" in item) ||
      !("height" in item)
    )
      return [];
    const typed = item as {
      str: string;
      transform: number[];
      width: number;
      height: number;
    };
    if (!typed.str.trim()) return [];
    const [a, b, c, d, x, y] = typed.transform,
      h = Math.hypot(a, b) || 1,
      v = Math.hypot(c, d) || 1;
    const [va, vb, vc, vd, ve, vf] = viewport.transform;
    const corners = [
      [x, y],
      [x + (a / h) * typed.width, y + (b / h) * typed.width],
      [x + (c / v) * typed.height, y + (d / v) * typed.height],
      [
        x + (a / h) * typed.width + (c / v) * typed.height,
        y + (b / h) * typed.width + (d / v) * typed.height,
      ],
    ].map(([px, py]) => ({
      x: va * px + vc * py + ve,
      y: vb * px + vd * py + vf,
    }));
    return [
      {
        text: typed.str,
        confidence: 95,
        bbox: {
          x0: Math.min(...corners.map((p) => p.x)),
          y0: Math.min(...corners.map((p) => p.y)),
          x1: Math.max(...corners.map((p) => p.x)),
          y1: Math.max(...corners.map((p) => p.y)),
        },
      },
    ];
  });
}
