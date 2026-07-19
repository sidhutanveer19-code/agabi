"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { Howl } from "howler";
import { color, font, radius } from "@/design-system/tokens";
import { Button } from "@/design-system/primitives/Button";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({
  kind: z.enum(["image", "audio"]).default("image"),
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
});
type Data = z.infer<typeof schema>;

function AudioPlayer({ src, caption }: { src: string; caption?: string }) {
  const howl = useRef<Howl | null>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    if (!howl.current) {
      howl.current = new Howl({ src: [src], html5: true, onend: () => setPlaying(false) });
    }
    if (playing) {
      howl.current.pause();
      setPlaying(false);
    } else {
      howl.current.play();
      setPlaying(true);
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: font.sans }}>
      <Button variant="primary" onClick={toggle}>
        {playing ? "Pause" : "Play"}
      </Button>
      {caption && <span style={{ color: color.muted, fontSize: 13 }}>{caption}</span>}
    </div>
  );
}

function Renderer({ data }: BlockRendererProps<Data>) {
  if (data.kind === "audio") {
    return <AudioPlayer src={data.src} caption={data.caption} />;
  }
  return (
    <figure style={{ margin: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data-URI / arbitrary media source */}
      <img
        src={data.src}
        alt={data.alt ?? ""}
        style={{ maxWidth: "100%", borderRadius: radius.lg, display: "block", border: `1px solid ${color.border}` }}
      />
      {data.caption && (
        <figcaption style={{ marginTop: 8, color: color.muted, fontSize: 13, fontFamily: font.sans }}>
          {data.caption}
        </figcaption>
      )}
    </figure>
  );
}

const SAMPLE_IMG =
  "data:image/svg+xml;utf8," +
  "<svg xmlns='http://www.w3.org/2000/svg' width='420' height='240'>" +
  "<rect width='420' height='240' fill='%230a0c11'/>" +
  "<circle cx='210' cy='120' r='74' fill='none' stroke='%236fcf97' stroke-width='3'/>" +
  "<circle cx='210' cy='120' r='30' fill='none' stroke='%23a78bfa' stroke-width='3'/>" +
  "<text x='210' y='210' fill='%23f3eee6' font-family='sans-serif' font-size='16' text-anchor='middle'>Animal cell</text>" +
  "</svg>";

export const mediaBlock = defineBlock<Data>({
  type: "media",
  label: "Media",
  category: "media",
  defaultSize: { w: 460, h: 280 },
  schema,
  Renderer,
  sample: { kind: "image", src: SAMPLE_IMG, alt: "Animal cell diagram", caption: "A labelled animal cell." },
});
