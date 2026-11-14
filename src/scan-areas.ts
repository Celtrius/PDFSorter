import { DEFAULT_CROP, normalizeCrop, type CropRect } from "./crop";
export const MAX_SCAN_AREAS = 6;
export type ScanProfile = "shared" | "odd" | "even";
export type ScanAreas = {
  mode: "all" | "alternating";
  shared: CropRect[];
  split: { odd: CropRect[]; even: CropRect[] } | null;
};
export function createScanAreas(): ScanAreas {
  return { mode: "all", shared: [{ ...DEFAULT_CROP }], split: null };
}
const clone = (areas: CropRect[]) => areas.map((area) => ({ ...area }));
export function setScanMode(
  settings: ScanAreas,
  mode: ScanAreas["mode"],
): ScanAreas {
  return {
    ...settings,
    mode,
    split:
      settings.split ??
      (mode === "alternating"
        ? { odd: clone(settings.shared), even: clone(settings.shared) }
        : null),
  };
}
// The index is the original, zero-based PDF scan index. Preserved opening
// pages never shift parity, and printed page numbers never determine it.
export function profileForScan(
  settings: ScanAreas,
  index: number,
): ScanProfile {
  return settings.mode === "all" ? "shared" : index % 2 === 0 ? "odd" : "even";
}
export function areasForProfile(
  settings: ScanAreas,
  profile: ScanProfile,
): CropRect[] {
  return profile === "shared"
    ? settings.shared
    : (settings.split?.[profile] ?? settings.shared);
}
export function areasForScan(settings: ScanAreas, index: number): CropRect[] {
  return areasForProfile(settings, profileForScan(settings, index));
}
export function replaceProfileAreas(
  settings: ScanAreas,
  profile: ScanProfile,
  areas: CropRect[],
): ScanAreas {
  const safe = (areas.length ? areas : [{ ...DEFAULT_CROP }])
    .slice(0, MAX_SCAN_AREAS)
    .map(normalizeCrop);
  if (profile === "shared") return { ...settings, shared: safe };
  const initialized = setScanMode(settings, "alternating");
  return { ...settings, split: { ...initialized.split!, [profile]: safe } };
}
export function editScanArea(
  settings: ScanAreas,
  profile: ScanProfile,
  index: number,
  rect: CropRect,
): ScanAreas {
  return replaceProfileAreas(
    settings,
    profile,
    areasForProfile(settings, profile).map((area, i) =>
      i === index ? normalizeCrop(rect) : area,
    ),
  );
}
