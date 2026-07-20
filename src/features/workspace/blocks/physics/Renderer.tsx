"use client";

import { useEffect, useRef, useState } from "react";
import Matter from "matter-js";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius, space } from "@/config/tokens";

export type PhysicsPreset = "gravity" | "pendulum" | "stack";

export interface PhysicsData {
  preset: PhysicsPreset;
}

const PRESETS: { id: PhysicsPreset; label: string }[] = [
  { id: "gravity", label: "Gravity" },
  { id: "pendulum", label: "Pendulum" },
  { id: "stack", label: "Stack" },
];

/** Body palette — Agabi accents so the sim reads as native chrome, not raw Matter. */
const FILLS = [color.cyan, color.violet2, color.green, color.gold, color.orange];

/** Build the bodies + constraints for one preset, sized to the current container. */
function buildScene(preset: PhysicsPreset, w: number, h: number): Matter.Body[] {
  const wall = (x: number, y: number, bw: number, bh: number) =>
    Matter.Bodies.rectangle(x, y, bw, bh, {
      isStatic: true,
      render: { fillStyle: color.surfaceActive },
    });

  const floor = wall(w / 2, h - 8, w, 16);
  const left = wall(8, h / 2, 16, h);
  const right = wall(w - 8, h / 2, 16, h);

  if (preset === "pendulum") {
    const anchor = { x: w / 2, y: Math.max(24, h * 0.18) };
    const armLen = Math.min(w, h) * 0.34;
    const bob = Matter.Bodies.circle(anchor.x + armLen, anchor.y, Math.max(14, Math.min(w, h) * 0.06), {
      restitution: 0.9,
      frictionAir: 0.001,
      render: { fillStyle: color.violet2 },
    });
    const rod = Matter.Constraint.create({
      pointA: anchor,
      bodyB: bob,
      stiffness: 1,
      length: armLen,
      render: { strokeStyle: color.borderStrong, lineWidth: 2 },
    });
    const pin = Matter.Bodies.circle(anchor.x, anchor.y, 5, {
      isStatic: true,
      render: { fillStyle: color.cyan },
    });
    return [floor, left, right, pin, bob, rod as unknown as Matter.Body];
  }

  if (preset === "stack") {
    const cols = Math.max(3, Math.floor(w / 90));
    const rows = Math.max(3, Math.floor(h / 120));
    const size = Math.min(w / (cols + 2), 46);
    const stack = Matter.Composites.stack(
      w / 2 - (cols * size) / 2,
      h - 16 - rows * size,
      cols,
      rows,
      2,
      2,
      (x: number, y: number) =>
        Matter.Bodies.rectangle(x, y, size, size, {
          restitution: 0.2,
          friction: 0.6,
          render: { fillStyle: FILLS[(Math.floor(x + y)) % FILLS.length] },
        }),
    );
    return [floor, left, right, ...stack.bodies];
  }

  // gravity — a spray of falling boxes + balls.
  const count = Math.max(6, Math.round((w * h) / 22000));
  const bodies: Matter.Body[] = [floor, left, right];
  for (let i = 0; i < count; i++) {
    const x = 24 + Math.random() * (w - 48);
    const y = 20 + Math.random() * (h * 0.5);
    const fill = FILLS[i % FILLS.length];
    const body =
      i % 2 === 0
        ? Matter.Bodies.circle(x, y, 12 + Math.random() * 12, {
            restitution: 0.65,
            render: { fillStyle: fill },
          })
        : Matter.Bodies.rectangle(x, y, 22 + Math.random() * 18, 22 + Math.random() * 18, {
            restitution: 0.4,
            angle: Math.random() * Math.PI,
            render: { fillStyle: fill },
          });
    bodies.push(body);
  }
  return bodies;
}

/** matter-js 2D physics renderer (lazy-loaded). Present-only sim; preset editable in dev. */
export default function PhysicsRenderer({ block, editing, onChange }: BlockRendererProps<PhysicsData>) {
  const preset: PhysicsPreset = block.data?.preset ?? "gravity";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Track container size so the world always fills the block (resize-aware).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        Math.round(r.width) === prev.w && Math.round(r.height) === prev.h
          ? prev
          : { w: Math.round(r.width), h: Math.round(r.height) },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build / rebuild the simulation whenever the preset or container size changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 40 || size.h < 40) return;

    const engine = Matter.Engine.create();
    const render = Matter.Render.create({
      canvas,
      engine,
      options: {
        width: size.w,
        height: size.h,
        wireframes: false,
        background: "transparent",
        pixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      },
    });

    Matter.Composite.add(engine.world, buildScene(preset, size.w, size.h));

    const runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);
    Matter.Render.run(render);

    return () => {
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.Composite.clear(engine.world, false, true);
      Matter.Engine.clear(engine);
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [preset, size.w, size.h]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Physics simulation: ${preset} preset`}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />

      {editing ? (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          role="group"
          aria-label="Choose physics preset"
          style={{
            position: "absolute",
            top: space[2],
            left: space[2],
            display: "flex",
            gap: space[1],
            padding: space[1],
            borderRadius: radius.pill,
            background: color.surface,
            border: `1px solid ${color.border}`,
            fontFamily: font.mono,
            fontSize: 11,
          }}
        >
          {PRESETS.map((p) => {
            const active = p.id === preset;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChange?.({ preset: p.id })}
                style={{
                  cursor: "pointer",
                  padding: `${space[1]}px ${space[3]}px`,
                  borderRadius: radius.pill,
                  border: `1px solid ${active ? color.cyan : "transparent"}`,
                  background: active ? color.surfaceActive : "transparent",
                  color: active ? color.cyanText : color.muted,
                  fontFamily: font.mono,
                  fontSize: 11,
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
