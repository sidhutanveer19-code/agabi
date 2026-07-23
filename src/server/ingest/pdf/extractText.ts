import { PDFParse } from "pdf-parse";

/**
 * PDF → text (A-4). Uses `pdf-parse` (approved E8/G6 dependency — free, local, offline, no API).
 * This is used at DATASET-BUILD time to turn a licensed PDF into normalized markdown; PDFs never
 * enter the direct-ingest path (the format registry is sync/string; PDF is binary/async). Server-only.
 */
export interface PdfExtract {
  text: string;
  pages: number;
}

export async function extractPdfText(bytes: Buffer | Uint8Array): Promise<PdfExtract> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const parser = new PDFParse({ data });
  const r = (await parser.getText()) as { text?: unknown; total?: unknown };
  return { text: String(r.text ?? ""), pages: Number(r.total ?? 0) };
}
