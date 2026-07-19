import { z } from "zod";

export const pdfSchema = z.object({ src: z.string() });
export type PdfData = z.infer<typeof pdfSchema>;

/** No offline sample document; the block previews any PDF URL supplied via data.src. */
export const pdfSample: PdfData = { src: "" };
