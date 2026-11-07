import "server-only";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { HASH_SOURCE_LABEL, type TimelineEntry } from "@/lib/agents";
import { sanitizePdfText } from "@/lib/pdfText";

/**
 * The evidence PDF attached to PayPal provide-evidence. Text is sanitized for
 * the standard font, wrapped by measured width, and paginated, so a long or
 * unusual draft can never crash the one-shot submission.
 */

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of sanitizePdfText(text).split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        line = word;
        continue;
      }
      // Break a single long token (hashes, URLs) by character.
      let chunk = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 64;
const INK = rgb(0.06, 0.1, 0.2);
const MUTED = rgb(0.39, 0.45, 0.55);

function when(at?: string) {
  if (!at) return "-";
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export async function buildEvidencePdf(input: {
  disputeId: string;
  reason: string;
  receiptHash?: string;
  approvedBy?: string;
  approvedAt?: string;
  paypalOrderId?: string;
  captureId?: string;
  product?: string;
  amount?: string;
  classification?: string;
  draft?: string;
  hashVerified?: boolean;
  hashSource?: string;
  disputeCustomId?: string;
  vaultApprovedAt?: string;
  capture?: { status?: string; amount?: string; currency?: string; createTime?: string };
  timeline?: TimelineEntry[];
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`RelayPay evidence packet - dispute ${input.disputeId}`);
  doc.setAuthor("RelayPay");
  doc.setSubject("Merchant dispute evidence with a hash-verified approval receipt");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < BOTTOM) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };
  const write = (text: string, size = 11, isBold = false, color = INK) => {
    const usedFont = isBold ? bold : font;
    for (const line of wrapText(text, usedFont, size, CONTENT_WIDTH)) {
      ensureSpace(size + 6);
      page.drawText(line, { x: MARGIN, y, size, font: usedFont, color });
      y -= size + 6;
    }
  };
  const heading = (text: string) => {
    y -= 8;
    ensureSpace(40);
    write(text, 13, true);
  };

  write("RelayPay - Evidence Packet", 18, true);
  write(`PayPal dispute ${input.disputeId} - reason ${input.reason}`, 11);
  if (input.classification) write(input.classification, 11, false, MUTED);

  const sourceLabel = HASH_SOURCE_LABEL[input.hashSource || ""] || "PayPal record";
  heading("1. Hash verification");
  write(
    input.hashVerified
      ? `VERIFIED: the SHA-256 hash in the ${sourceLabel} matches the owner-approved receipt.`
      : "NOT VERIFIED: no matching receipt hash was found in PayPal's records.",
    11,
    true,
    input.hashVerified ? rgb(0.02, 0.45, 0.28) : rgb(0.7, 0.08, 0.08)
  );
  write(`PayPal custom_id: ${input.disputeCustomId || "-"}`, 10);
  write(`Receipt SHA-256:  ${input.receiptHash || "-"}`, 10);

  heading("2. Authorization");
  write(`Buyer saved PayPal for future payments (Vault consent): ${when(input.vaultApprovedAt)}`);
  write(`Order approved by the cafe owner (${input.approvedBy || "-"}) at ${when(input.approvedAt)}, before payment.`);
  write(`Item: ${input.product || "-"}${input.amount ? ` - ${input.amount} USD` : ""}`);

  heading("3. PayPal payment");
  write(`Order ${input.paypalOrderId || "-"}, capture ${input.captureId || "-"}`);
  if (input.capture) {
    write(`PayPal reports the capture as ${input.capture.status || "-"}: ${input.capture.amount || "-"} ${input.capture.currency || ""}, ${when(input.capture.createTime)}`);
  }

  if (input.timeline?.length) {
    heading("4. Timeline");
    for (const t of input.timeline.slice(0, 20)) write(`${when(t.at)}  ${t.actor}: ${t.event}${t.detail ? ` (${t.detail})` : ""}`, 10);
  }

  heading(`${input.timeline?.length ? 5 : 4}. Merchant response`);
  write(input.draft || "No merchant response was generated.", 10.5);

  y -= 10;
  write(
    "Generated by RelayPay for the supplier. The approval receipt is sealed when the cafe owner approves the order; its SHA-256 fingerprint travels with the PayPal payment as custom_id. That shows the record existed at payment time and is unchanged; anyone holding the receipt can recompute the fingerprint and compare it with PayPal's record.",
    8.5,
    false,
    MUTED
  );

  const pages = doc.getPages();
  pages.forEach((p, index) => {
    p.drawText(`RelayPay evidence packet - page ${index + 1} of ${pages.length}`, { x: MARGIN, y: 30, size: 8, font, color: MUTED });
  });

  return Buffer.from(await doc.save());
}
