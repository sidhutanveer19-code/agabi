"use client";

import { useEffect, useRef } from "react";
import { Timeline } from "vis-timeline/standalone";
import "vis-timeline/styles/vis-timeline-graph2d.css";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { TimelineData } from "./schema";

export function Renderer({ data }: BlockRendererProps<TimelineData>) {
  const ref = useRef<HTMLDivElement>(null);
  const tlRef = useRef<Timeline | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    tlRef.current?.destroy();
    tlRef.current = new Timeline(ref.current, data.items, {
      height: 300,
      margin: { item: 12 },
      stack: true,
      showCurrentTime: false,
      zoomable: true,
    });
    return () => {
      tlRef.current?.destroy();
      tlRef.current = null;
    };
  }, [data.items]);

  return <div ref={ref} className="agabi-timeline" style={{ width: "100%" }} />;
}
