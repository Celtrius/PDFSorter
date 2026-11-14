# Folio — local PDF page sorter

A one-page, static React + TypeScript app for putting scanned book pages back in order using their **printed Arabic page numbers**. Built with Vite, Tailwind CSS 4, and local shadcn/ui-style components (Radix primitives + CVA). No backend, API keys, accounts, analytics, or external fonts.

## Run locally

Use Node **22.12+** or Node **24 LTS** and npm.

```sh
npm ci
npm run dev
```

The install step copies the pinned npm packages' PDF/OCR assets into `public/ocr/`: Tesseract worker, all six available WASM core variants, and English LSTM trained data. These generated files are ignored by Git, copied again on every `npm ci`, and included in the production build. npm needs network access during setup. There are **no runtime CDN requests**: the app and OCR assets are served from the same host. Serve the build over HTTP(S); opening `index.html` with `file://` is unsupported.

```sh
npm run check       # TypeScript
npm test            # ordering, diagnostics, PDF export/reimport metadata
npm run build       # typecheck + production build in dist/
npm run preview     # serve production build locally
```

Optional browser verification (Chromium is a one-time test-only download):

```sh
npx playwright install chromium
npm run test:e2e
```

The browser tests create a genuine image-only scanned PDF, run local OCR, check duplicate review/editing and invalid-input blocking, export and reimport the result without OCR, assert no external requests, and verify cancellation and a missing-language failure recover visibly.

## Using Folio

1. Choose or drop a PDF.
2. Inspect the full PDF preview with page navigation and fit/zoom controls. **Automatic** is the default: it searches the whole page for a confident, isolated number in an outer margin. Uncertain results stay blank for review.
   To override the search, choose **Select areas**. Add up to six candidate rectangles, choose one using its numbered button or by clicking it in the preview, then drag to redraw it or edit Left/Top/Width/Height percentages. Remove retains at least one area; Reset restores the bottom-15% default for the active profile. Every area is checked; matching results are deduplicated, and conflicting numbers stay unresolved.
   Manual areas default to **All scans**, which is appropriate for shuffled scans. Optional **Odd/even scans** keeps separate areas for original PDF scans 1, 3, 5… and 2, 4, 6…. Preview navigation selects the corresponding profile. This is scan-order parity, never inferred printed-page parity, and preserving opening pages does not shift it. Switching modes preserves shared and split edits. Automatic detection ignores these manual areas and profiles.
3. **Keep first pages in place** preserves the first N original PDF pages at the very front and skips recognizing them. Use it for a cover, title pages, or table of contents. Set it to zero to recognize every page.
4. Recognize pages. Existing PDF text is used when it provides a usable contextual candidate; otherwise Tesseract reads the page in Automatic mode, or a full-width contextual band around each manual rectangle. Number tokens must fit entirely inside the intended region: context outside a manual rectangle can reject a misleading number but cannot supply an answer. Cancel discards partial results and returns to the settings.
5. Review numbers. Blank fields mean unnumbered. Values must be whole numbers from 0 to 999999. Check duplicates, missing numbers within the detected range, and confidence below 80%. “Needs attention” captures a review list when selected; edited cards stay visible so focus is preserved. Click the filter again to refresh it.
6. Preview and save. Opening pages remain first, numbered pages sort numerically, equal numbers preserve their original relative order, and unnumbered pages keep their original relative order at the end. No page is dropped or synthesized.

## How it works

- `src/process.ts`: PDF.js compatibility (legacy) worker loads the PDF, renders one page at a time (maximum 1600 pixels wide and four million pixels), makes a 150-pixel thumbnail, and runs automatic detection or checks every selected manual rectangle. A single reusable Tesseract worker runs recognition only when needed. Render canvases and PDF page resources are released as processing advances; worker and document resources are released on completion/cancellation. Generation tokens prevent stale runs from updating a new upload.
- `src/contextual.ts`: shared PDF-text/OCR word geometry, contextual isolation, and automatic margin ranking. Automatic candidates need OCR word confidence of at least 80 and a center within the top/bottom 15% or left/right 8% of the displayed page. Body-only numbers are not accepted. Margin depth and confidence rank candidates, but different eligible margin values remain a conflict rather than selecting the first. Manual candidates need confidence of at least 70. Full token boxes must fit the selected area (one-pixel rounding tolerance). Nearby words, numbers, or punctuation on the same baseline within twice their height reject a numeric token, which helps avoid `Obj. 6`, `Chapter 1`, and `12 apples`. OCR reads letters as well as digits so prose context is retained. The same rules apply to PDF text-item boxes; uncertain or partially selected tokens are left unknown.
- `src/scan-areas.ts` and `src/recognition.ts`: immutable shared/scan-parity profiles and conservative aggregation across all regions. Repeated equal numbers are deduplicated; conflicting or ambiguous evidence cannot be overridden by a later region. Accepted confidence is the minimum of contributing readings.
- `src/model.ts`: pure numeric sorting, conservative single-number parsing, and diagnostics. Gap reporting is capped at 100 displayed values to avoid huge lists after a misread. Low confidence and sequence gaps are hints, not proof of an error.
- `src/pdf.ts`: pdf-lib copies the original PDF page objects into a new document. **The exported PDF does not rasterize the pages**, so existing image quality is preserved. PDF bytes are rewritten, not byte-for-byte identical.
- Each exported page gets an invisible custom page-dictionary entry, `/FolioPageNumber << /Version 1 /Number 123 >>`. A validated version-1 numeric value is restored on a later Folio import and skips OCR. Unnumbered pages store `null` and are retried next time. “Recheck saved numbers” ignores all saved values. This is application metadata, not a visible annotation or PDF page-label display.
- `src/App.tsx`: upload/settings, cancellation-safe progress, paginated review (24 thumbnails at a time), accessible Radix preview dialog, and Blob-based download. The full PDF canvas preview supports pointer/touch rectangle selection and accessible numeric controls. Review thumbnails open the original page in a readable preview dialog. PDF and OCR libraries load only when previewing/processing/exporting is requested.

All PDF bytes, extracted text, images, and OCR results stay in the browser. The app itself makes only same-origin asset requests. The host can observe ordinary asset requests, but no file content is sent to it. Browser extensions and your browser's own behavior are outside the app's control. Tesseract may cache its language data in browser storage; the app does not persist your PDFs or page results.

“Local assets” means no CDN is needed after hosting. This app does not install a service worker or promise offline reloads: the browser must still be able to fetch any assets not already cached.

## Deploy to GitHub Pages

1. Create a GitHub repository, put the **contents of this project directory at the repository root**, and push to `main`.
2. In repository **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. The included `.github/workflows/deploy.yml` runs `npm ci`, unit tests, and the production build, uploads `dist/`, and deploys it with the official Pages actions. You can also run it manually from Actions.

Vite uses `base: './'`, so assets work at both `https://user.github.io/repository/` and a custom domain. This is a single page with no client-side routes or server requirements. For other static hosts, upload `dist/` after `npm ci && npm run build`.

## Limitations

- OCR is heuristic. Tiny, faint, skewed, rotated, handwritten, or ornamental page numbers may be wrong or absent. Roman numerals, chapter-relative numbering such as `4-12`, and multiple printed numbering systems are not supported. Review the results before saving.
- Detection is deliberately conservative, not a guarantee. Automatic mode can miss unusual page numbers in the body, near prose, or away from the configured margin heuristics. An isolated figure/exercise number in a margin may still resemble a page number. Use Select areas or manual review for unusual layouts. Conflicting margin candidates remain unresolved; the app never guesses from page sequence because scans may be shuffled.
- Manual contextual bands can reject a number because of nearby text outside the rectangle. Very tight crops, partial tokens, mixed text orientations, bad OCR word boxes, or low confidence may therefore produce no answer. Adding more areas increases OCR work (up to six per active profile).
- Encrypted/password-protected PDFs are not supported. Damaged files may fail to load. Signed PDFs lose signature validity when rewritten; use a copy. Copying pages may not preserve document-level bookmarks, forms, attachments, accessibility structure, or other interactive document features. This tool is intended for scanned books, not interactive documents.
- Other PDF editors, optimizers, printers, and metadata scrubbers may remove the custom page metadata. Such pages will need recognition again. Metadata numbers are validated for format/version, but cannot prove that another editor has not changed the visible page content.
- There is no app-enforced PDF size limit. Large books can consume substantial browser memory: the original bytes, PDF structures, output bytes, and small thumbnails remain in memory. OCR is sequential and CPU intensive. Very large files may fail to load or process if the browser runs out of memory.
- Modern browsers with workers, WebAssembly, and canvas are required. PDF.js uses its official compatibility build, including the worker, to support browsers without the newest typed-array encoding methods. Keep the tab open while recognizing pages. Recognition is for English-trained Arabic digits; it is not full-document OCR and does not add a searchable text layer.

No existing project outside this directory is modified. Nothing has been published or deployed automatically.
