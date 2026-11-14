import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readSavedNumbers } from "../src/pdf";
test("real scanned PDF: local OCR, review, stable sorting, export and metadata reuse", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const pngs = await page.evaluate(() =>
    [null, 3, 1, 2, 2].map((number) => {
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 800;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 600, 800);
      ctx.fillStyle = "black";
      ctx.font = "28px Georgia";
      ctx.fillText("A chapter of a book", 90, 180);
      if (number !== null) {
        ctx.font = "36px Arial";
        ctx.fillText(String(number), 285, 755);
      }
      return canvas.toDataURL("image/png");
    }),
  );
  const pdf = await PDFDocument.create();
  for (const png of pngs) {
    const image = await pdf.embedPng(png);
    const sheet = pdf.addPage([600, 800]);
    sheet.drawImage(image, { x: 0, y: 0, width: 600, height: 800 });
  }
  const buffer = Buffer.from(await pdf.save());
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4173") &&
      !request.url().startsWith("data:") &&
      !request.url().startsWith("blob:")
    )
      external.push(request.url());
  });
  await page.getByLabel("Upload PDF").setInputFiles({
    name: "shuffled-book.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await page.getByLabel("Detection", { exact: true }).selectOption("areas");
  await page.getByLabel("Keep first pages in place").fill("1");
  await page
    .getByRole("button", { name: "Recognize pages", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Review pages" })).toBeVisible({
    timeout: 90000,
  });
  await expect(page.locator("#number-1")).toHaveValue("3");
  await expect(page.locator("#number-2")).toHaveValue("1");
  await expect(page.locator("#number-3")).toHaveValue("2");
  await expect(page.locator("#number-4")).toHaveValue("2");
  await page.getByRole("button", { name: "Needs attention" }).click();
  await page.locator("#number-4").fill("4");
  await expect(page.locator("#number-4")).toBeVisible();
  await page.locator("#number-4").fill("-1");
  await expect(
    page.getByRole("button", { name: "Save sorted PDF" }),
  ).toBeDisabled();
  await page.locator("#number-4").fill("4");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save sorted PDF" }).click();
  const download = await downloadEvent;
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const saved = await readFile(path!);
  expect([...(await readSavedNumbers(saved))]).toEqual([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ]);
  await page.getByRole("button", { name: "Change settings" }).click();
  await page.getByLabel("Upload PDF").setInputFiles({
    name: "saved.pdf",
    mimeType: "application/pdf",
    buffer: saved,
  });
  let ocrRequested = false;
  await page.route("**/ocr/**", (route) => {
    ocrRequested = true;
    return route.abort();
  });
  await page
    .getByRole("button", { name: "Recognize pages", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Review pages" }),
  ).toBeVisible();
  expect(ocrRequested).toBe(false);
  await expect(page.getByText("Saved number")).toHaveCount(4);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
test("worker asset failure recovers visibly and cancellation can start a new run", async ({
  page,
}) => {
  await page.goto("/");
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const buffer = Buffer.from(await pdf.save());
  await page
    .getByLabel("Upload PDF")
    .setInputFiles({ name: "blank.pdf", mimeType: "application/pdf", buffer });
  await page
    .getByRole("button", { name: "Recognize pages", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel recognition" }).click();
  await expect(
    page.getByRole("button", { name: "Recognize pages", exact: true }),
  ).toBeEnabled();
  await page.route("**/ocr/lang/**", (route) =>
    route.fulfill({ status: 404, body: "Missing language data" }),
  );
  await page
    .getByRole("button", { name: "Recognize pages", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 90000 });
  await expect(
    page.getByRole("button", { name: "Recognize pages", exact: true }),
  ).toBeEnabled();
});
