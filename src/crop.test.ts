import { describe, expect, it } from "vitest";
import {
  containsPdfPoint,
  cropFromDrag,
  DEFAULT_CROP,
  MIN_CROP,
  normalizeCrop,
  pixelCrop,
  relativePoint,
  textItemCenter,
} from "./crop";
describe("normalized scan selection", () => {
  it("locates text centers along transformed text axes", () => {
    expect(
      textItemCenter({
        transform: [12, 0, 0, 12, 100, 200],
        width: 20,
        height: 10,
      }),
    ).toEqual({ x: 110, y: 205 });
    expect(
      textItemCenter({
        transform: [0, 12, -12, 0, 100, 200],
        width: 20,
        height: 10,
      }),
    ).toEqual({ x: 95, y: 210 });
  });
  it("maps pointer coordinates independently of preview zoom and scroll offsets", () => {
    expect(
      relativePoint(150, 250, { left: 50, top: 50, width: 200, height: 400 }),
    ).toEqual({ x: 0.5, y: 0.5 });
    expect(
      relativePoint(-10, 800, { left: 50, top: 50, width: 200, height: 400 }),
    ).toEqual({ x: 0, y: 1 });
  });
  it("supports dragging in every direction with the same rectangle", () => {
    expect(cropFromDrag({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.7 })).toEqual(
      cropFromDrag({ x: 0.2, y: 0.7 }, { x: 0.8, y: 0.9 }),
    );
    const area = cropFromDrag({ x: -1, y: 0.5 }, { x: 2, y: 0.8 });
    expect(area.x).toBe(0);
    expect(area.width).toBe(1);
    expect(area.height).toBeCloseTo(0.3);
  });
  it("clamps invalid and out-of-bounds rectangles to a nonempty area", () => {
    expect(normalizeCrop({ x: 2, y: -1, width: 0, height: Infinity })).toEqual({
      x: 1 - MIN_CROP,
      y: 0,
      width: MIN_CROP,
      height: MIN_CROP,
    });
    const edge = cropFromDrag({ x: 1, y: 1 }, { x: 1, y: 1 });
    expect(edge).toEqual({ x: 0.99, y: 0.99, width: 0.01, height: 0.01 });
    expect(normalizeCrop({ x: 0.8, y: 0.8, width: 4, height: 4 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
  it("maps selection to bounded integer pixels, rounding outward", () => {
    expect(pixelCrop(DEFAULT_CROP, 1000, 2000)).toEqual({
      x: 0,
      y: 1700,
      width: 1000,
      height: 300,
    });
    expect(
      pixelCrop({ x: 0.123, y: 0.456, width: 0.1, height: 0.1 }, 101, 203),
    ).toEqual({ x: 12, y: 92, width: 11, height: 21 });
    expect(pixelCrop({ x: 1, y: 1, width: 0, height: 0 }, 1, 1)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
  it("uses displayed viewport coordinates for text even with rotation and crop-box offsets", () => {
    const crop = { x: 0.7, y: 0.1, width: 0.2, height: 0.2 };
    const rotated = {
      width: 400,
      height: 600,
      transform: [0, 1, 1, 0, -20, -10],
    };
    expect(containsPdfPoint(crop, 100, 340, rotated)).toBe(true);
    expect(containsPdfPoint(crop, 400, 340, rotated)).toBe(false);
    expect(containsPdfPoint(crop, 100, 100, rotated)).toBe(false);
    const standard = {
      width: 400,
      height: 600,
      transform: [1, 0, 0, -1, -20, 620],
    };
    expect(containsPdfPoint(DEFAULT_CROP, 200, 50, standard)).toBe(true);
    expect(containsPdfPoint(DEFAULT_CROP, 200, 400, standard)).toBe(false);
  });
});
