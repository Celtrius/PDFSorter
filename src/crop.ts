export type CropRect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export const DEFAULT_CROP: CropRect = { x: 0, y: 0.85, width: 1, height: 0.15 };
export const MIN_CROP = 0.01;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
export function normalizeCrop(rect: CropRect): CropRect {
  const width = clamp(rect.width, MIN_CROP, 1);
  const height = clamp(rect.height, MIN_CROP, 1);
  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height,
  };
}
export function relativePoint(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
): Point {
  return {
    x: clamp((clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
    y: clamp((clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
  };
}
export function cropFromDrag(start: Point, end: Point): CropRect {
  const a = { x: clamp(start.x, 0, 1), y: clamp(start.y, 0, 1) },
    b = { x: clamp(end.x, 0, 1), y: clamp(end.y, 0, 1) };
  return normalizeCrop({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });
}
export function pixelCrop(rect: CropRect, width: number, height: number) {
  const crop = normalizeCrop(rect);
  const x = Math.min(width - 1, Math.floor(crop.x * width));
  const y = Math.min(height - 1, Math.floor(crop.y * height));
  return {
    x,
    y,
    width: Math.max(
      1,
      Math.min(width, Math.ceil((crop.x + crop.width) * width)) - x,
    ),
    height: Math.max(
      1,
      Math.min(height, Math.ceil((crop.y + crop.height) * height)) - y,
    ),
  };
}
export function containsPdfPoint(
  rect: CropRect,
  x: number,
  y: number,
  viewport: { width: number; height: number; transform: number[] },
): boolean {
  const [a, b, c, d, e, f] = viewport.transform;
  const point = {
    x: (a * x + c * y + e) / viewport.width,
    y: (b * x + d * y + f) / viewport.height,
  };
  const crop = normalizeCrop(rect);
  return (
    point.x >= crop.x &&
    point.x <= crop.x + crop.width &&
    point.y >= crop.y &&
    point.y <= crop.y + crop.height
  );
}

// Text item dimensions are lengths along the item's transformed axes, not
// necessarily the PDF page's x/y directions (vertical text and rotated glyphs).
export function textItemCenter(item: {
  transform: number[];
  width: number;
  height: number;
}): Point {
  const [a, b, c, d, x, y] = item.transform;
  const horizontal = Math.hypot(a, b) || 1,
    vertical = Math.hypot(c, d) || 1;
  return {
    x:
      x +
      ((a / horizontal) * item.width) / 2 +
      ((c / vertical) * item.height) / 2,
    y:
      y +
      ((b / horizontal) * item.width) / 2 +
      ((d / vertical) * item.height) / 2,
  };
}
