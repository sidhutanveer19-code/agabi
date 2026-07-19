import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { pdfSample, pdfSchema, type PdfData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={120} />,
});

export const pdfBlock = defineBlock<PdfData>({
  type: "pdf",
  label: "PDF",
  category: "media",
  defaultSize: { w: 560, h: 200 },
  schema: pdfSchema,
  Renderer,
  sample: pdfSample,
});
