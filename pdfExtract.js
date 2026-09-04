// Real PDF text extraction — reads the PDF's actual text layer and its on-page
// position, then reconstructs each row by clustering text items that share a
// vertical position and ordering them left-to-right. This avoids the classic
// copy/paste failure mode where a PDF viewer hands back text in column-major
// order (all dates, then all descriptions, then all amounts) instead of
// row-by-row — since here we're reading real coordinates, not clipboard order.
//
// This only works for PDFs that have a real text layer (i.e. not a scanned
// image of a statement). If a PDF was scanned rather than exported digitally,
// there is no text to extract and this will return no lines.

import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const Y_TOLERANCE = 2.5; // points; items within this vertical distance are treated as the same row

// Emitted as its own "line" between pages. A page break often carries footer content
// (page numbers, running totals, disclaimers) in the gap before the next page's first
// date — if a downstream parser bounds a transaction by "wherever the next date token
// is," that footer content can leak into the last transaction on a page and corrupt or
// discard it. This marker lets the parser treat a page boundary as a hard stop instead.
export const PAGE_BREAK_MARKER = "\u0000PDFEXTRACT_PAGE_BREAK\u0000";

// Thrown when a PDF needs a password — either none was supplied, or the one supplied
// was wrong. The UI checks `needsPassword` to decide whether to show a password prompt
// rather than a generic error.
export class PdfPasswordError extends Error {
  constructor(wasWrongPassword) {
    super(wasWrongPassword ? "That password didn't work." : "This PDF is password-protected.");
    this.name = "PdfPasswordError";
    this.needsPassword = true;
    this.wasWrongPassword = wasWrongPassword;
  }
}

async function loadPdfDocument(file, password) {
  const buf = await file.arrayBuffer();
  try {
    return await pdfjsLib.getDocument({ data: buf, password: password || undefined }).promise;
  } catch (err) {
    // pdfjs signals a password problem via error.name === "PasswordException", with
    // err.code distinguishing "none supplied yet" (1) from "supplied but wrong" (2).
    if (err && err.name === "PasswordException") {
      throw new PdfPasswordError(err.code === 2);
    }
    throw err;
  }
}

/**
 * @param {File} file
 * @param {string} [password] - supply if the PDF is known to be password-protected
 * @returns {Promise<string[]>} reconstructed lines, in reading order, across all pages,
 *   with PAGE_BREAK_MARKER inserted between each page's lines
 * @throws {PdfPasswordError} if the PDF needs a password that wasn't supplied, or wasn't correct
 */
export async function extractRowsFromPdf(file, password) {
  const pdf = await loadPdfDocument(file, password);
  const allLines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Cluster text items by vertical position (transform[5] is the y coordinate).
    const rows = []; // [{ y, items: [{x, str}] }]
    content.items.forEach((item) => {
      if (!item.str || !item.str.trim()) return;
      const x = item.transform[4];
      const y = item.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= Y_TOLERANCE);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, str: item.str });
    });

    // PDF y-coordinates increase upward, so sort descending for top-to-bottom reading order.
    rows.sort((a, b) => b.y - a.y);

    rows.forEach((row) => {
      row.items.sort((a, b) => a.x - b.x);
      const line = row.items.map((i) => i.str).join("  ").replace(/\s+/g, " ").trim();
      // Drop obvious page-footer noise here, at the source — otherwise it can merge into
      // whatever transaction happens to sit nearest the page boundary (there's no date
      // after it to bound the chunk before reaching this), and a downstream skip-filter
      // built to ignore standalone disclaimer lines would then discard that real
      // transaction along with the footer, since it can no longer tell them apart.
      if (line && !/^page\s+\d+\s+of\s+\d+$/i.test(line)) allLines.push(line);
    });

    if (pageNum < pdf.numPages) allLines.push(PAGE_BREAK_MARKER);
  }

  return allLines;
}

const RENDER_SCALE = 1.8; // higher = sharper text but bigger images; 1.8 is a reasonable balance
const MAX_RENDER_PAGES = 20; // soft safety cap — a typical monthly statement is well under this

/**
 * Renders each page to a PNG image instead of extracting text. Decryption happens the
 * same way as extractRowsFromPdf (pdfjs decrypts internally once a valid password is
 * supplied, and that applies to rendering too, not just text reads) — so this gets you
 * a genuinely decrypted view of the page without ever needing to re-serialize a
 * decrypted PDF file, which isn't something pdfjs-dist is built to do. Sending page
 * images to a vision-capable model lets it read the actual table layout directly,
 * sidestepping every layout-reconstruction issue text extraction runs into.
 * @param {File} file
 * @param {string} [password]
 * @returns {Promise<string[]>} base64-encoded PNG data, one entry per page (no data-URL prefix)
 * @throws {PdfPasswordError} same as extractRowsFromPdf
 */
export async function renderPdfPagesAsImages(file, password) {
  const pdf = await loadPdfDocument(file, password);
  const pageCount = Math.min(pdf.numPages, MAX_RENDER_PAGES);
  const images = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    images.push(dataUrl.split(",")[1]);
  }

  return { images, truncated: pdf.numPages > MAX_RENDER_PAGES, totalPages: pdf.numPages };
}
