import { validNumber } from "./model";
export type PrintedCandidates = { values: number[]; ambiguous: boolean };
export type RegionReading = PrintedCandidates & {
  confidence: number;
  source: "text" | "ocr";
};
// Entire lines must be numbers. Numbers embedded in prose are not candidates.
export function printedCandidates(text: string): PrintedCandidates {
  const values = [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[-–—.\s]*\d{1,6}[-–—.\s]*$/.test(line))
        .map((line) => Number(line.replace(/\D/g, "")))
        .filter(validNumber),
    ),
  ];
  return { values, ambiguous: values.length > 1 };
}
export function aggregateReadings(readings: RegionReading[]) {
  const values = [
    ...new Set(
      readings.flatMap((reading) => reading.values).filter(validNumber),
    ),
  ];
  const conflict =
    readings.some((reading) => reading.ambiguous) || values.length > 1;
  const number = !conflict && values.length === 1 ? values[0] : null;
  const contributors =
    number === null
      ? readings
      : readings.filter((reading) => reading.values.includes(number));
  const source = contributors.some((reading) => reading.source === "ocr")
    ? ("ocr" as const)
    : ("text" as const);
  const confidence =
    number === null
      ? 0
      : Math.min(
          ...contributors.map((reading) =>
            Number.isFinite(reading.confidence)
              ? Math.max(0, Math.min(100, reading.confidence))
              : 0,
          ),
        );
  return { number, confidence, source, conflict };
}
