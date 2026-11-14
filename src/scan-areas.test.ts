import { describe, expect, it } from "vitest";
import { DEFAULT_CROP } from "./crop";
import {
  areasForScan,
  createScanAreas,
  editScanArea,
  MAX_SCAN_AREAS,
  profileForScan,
  replaceProfileAreas,
  setScanMode,
} from "./scan-areas";
describe("scan profiles", () => {
  it("defaults to shared areas for all shuffled scans", () => {
    const settings = createScanAreas();
    expect(settings.mode).toBe("all");
    expect(profileForScan(settings, 0)).toBe("shared");
    expect(profileForScan(settings, 7)).toBe("shared");
    expect(areasForScan(settings, 1)).toEqual([DEFAULT_CROP]);
  });
  it("uses original scan parity independently of preserved opening pages", () => {
    const settings = setScanMode(createScanAreas(), "alternating");
    const preserved = 3;
    expect(
      [0, 1, 2, 3, 4, 5]
        .filter((index) => index >= preserved)
        .map((index) => profileForScan(settings, index)),
    ).toEqual(["even", "odd", "even"]);
  });
  it("seeds split profiles once and preserves independent edits across mode switches", () => {
    const original = createScanAreas();
    const shared = replaceProfileAreas(original, "shared", [
      DEFAULT_CROP,
      { x: 0, y: 0, width: 1, height: 0.1 },
    ]);
    const split = setScanMode(shared, "alternating");
    expect(split.split?.odd).toEqual(shared.shared);
    expect(split.split?.odd).not.toBe(shared.shared);
    const edited = editScanArea(split, "even", 0, {
      x: 0.7,
      y: 0,
      width: 0.2,
      height: 0.1,
    });
    const again = setScanMode(setScanMode(edited, "all"), "alternating");
    expect(again.split?.even[0].x).toBe(0.7);
    expect(again.shared).toEqual(shared.shared);
    expect(again.split?.odd).toEqual(shared.shared);
    expect(original.shared).toEqual([DEFAULT_CROP]);
  });
  it("updates a selected shared area immutably and enforces one to six regions", () => {
    const original = createScanAreas();
    const edited = editScanArea(original, "shared", 0, {
      x: 0,
      y: 0,
      width: 0.2,
      height: 0.1,
    });
    expect(areasForScan(edited, 12)[0].height).toBe(0.1);
    expect(original.shared[0]).toEqual(DEFAULT_CROP);
    expect(replaceProfileAreas(edited, "shared", []).shared.length).toBe(1);
    expect(
      replaceProfileAreas(
        edited,
        "shared",
        Array.from({ length: 20 }, () => DEFAULT_CROP),
      ).shared.length,
    ).toBe(MAX_SCAN_AREAS);
  });
});
