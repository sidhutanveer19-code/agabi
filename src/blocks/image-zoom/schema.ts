import { z } from "zod";

export const imageZoomSchema = z.object({ src: z.string(), alt: z.string().optional() });
export type ImageZoomData = z.infer<typeof imageZoomSchema>;

const SAMPLE =
  "data:image/svg+xml;utf8," +
  "<svg xmlns='http://www.w3.org/2000/svg' width='900' height='560'>" +
  "<rect width='900' height='560' fill='%230a0c11'/>" +
  "<g fill='none' stroke='%237dd3fc' stroke-width='2'>" +
  "<circle cx='450' cy='280' r='200'/><circle cx='450' cy='280' r='120'/><circle cx='450' cy='280' r='60'/></g>" +
  "<text x='450' y='285' fill='%23f3eee6' font-family='sans-serif' font-size='22' text-anchor='middle'>Zoom me</text>" +
  "</svg>";

export const imageZoomSample: ImageZoomData = { src: SAMPLE, alt: "Zoomable diagram" };
