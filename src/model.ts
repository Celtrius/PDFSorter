export type PageRecord = {
  index: number;
  number: number | null;
  confidence: number;
  source: "pending" | "ocr" | "text" | "saved" | "manual" | "preserved";
  thumbnail: string;
  conflict?: boolean;
};
export function validNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 999999
  );
}
export function sortedPages(pages: PageRecord[], preserve: number) {
  return [
    ...pages
      .filter((p) => p.index < preserve)
      .sort((a, b) => a.index - b.index),
    ...pages
      .filter((p) => p.index >= preserve)
      .sort(
        (a, b) =>
          (a.number ?? Infinity) - (b.number ?? Infinity) || a.index - b.index,
      ),
  ];
}
export function inspectPages(pages: PageRecord[], preserve: number) {
  const eligible = pages.filter((p) => p.index >= preserve);
  const counts = new Map<number, number>();
  eligible.forEach((p) => {
    if (p.number !== null)
      counts.set(p.number, (counts.get(p.number) ?? 0) + 1);
  });
  const duplicates = new Set(
    [...counts].filter(([, n]) => n > 1).map(([n]) => n),
  );
  const nums = [...counts.keys()].sort((a, b) => a - b);
  const missing: number[] = [];
  let missingCount = 0;
  for (let i = 1; i < nums.length; i++) {
    const gap = nums[i] - nums[i - 1] - 1;
    missingCount += gap;
    for (let n = nums[i - 1] + 1; n < nums[i] && missing.length < 100; n++)
      missing.push(n);
  }
  return {
    duplicates,
    missing,
    missingCount,
    unnumbered: eligible.filter((p) => p.number === null).length,
    low: eligible.filter((p) => p.number !== null && p.confidence < 80).length,
  };
}
// Only standalone Arabic numbers are candidates. Multiple candidates require review.
export function parsePrintedNumber(text: string): number | null {
  const candidates = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^[-–—.\s]*\d{1,6}[-–—.\s]*$/.test(s))
    .map((s) => Number(s.replace(/\D/g, "")))
    .filter(validNumber);
  return candidates.length === 1 ? candidates[0] : null;
}
