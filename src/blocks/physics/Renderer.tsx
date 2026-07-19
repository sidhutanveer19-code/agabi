"use client";

import { useEffect, useRef } from "react";
import Matter from "matter-js";
import { radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { PhysicsData } from "./schema";

const COLORS = ["#a78bfa", "#7dd3fc", "#6fcf97", "#e8944e", "#c4b5fd"];

export function Renderer({ data }: BlockRendererProps<PhysicsData>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { Engine, Render, Runner, Bodies, Composite, Mouse, MouseConstraint } = Matter;
    const w = el.clientWidth || 560;
    const h = 300;

    const engine = Engine.create();
    const render = Render.create({
      element: el,
      engine,
      options: { width: w, height: h, wireframes: false, background: "#0a0c11" },
    });

    const ground = Bodies.rectangle(w / 2, h - 8, w, 20, {
      isStatic: true,
      render: { fillStyle: "#3a3f4d" },
    });
    const walls = [
      Bodies.rectangle(-10, h / 2, 20, h, { isStatic: true, render: { visible: false } }),
      Bodies.rectangle(w + 10, h / 2, 20, h, { isStatic: true, render: { visible: false } }),
    ];
    const circles = Array.from({ length: data.bodies }, (_, i) =>
      Bodies.circle(50 + i * 44, 30 + (i % 3) * 26, 15, {
        restitution: 0.6,
        render: { fillStyle: COLORS[i % COLORS.length] },
      })
    );
    Composite.add(engine.world, [ground, ...walls, ...circles]);

    const mouse = Mouse.create(render.canvas);
    const mc = MouseConstraint.create(engine, {
      mouse,
      constraint: { stiffness: 0.2, render: { visible: false } },
    });
    Composite.add(engine.world, mc);

    const runner = Runner.create();
    Runner.run(runner, engine);
    Render.run(render);

    return () => {
      Render.stop(render);
      Runner.stop(runner);
      render.canvas.remove();
      Engine.clear(engine);
    };
  }, [data.bodies]);

  return (
    <div
      ref={ref}
      style={{ width: "100%", height: 300, borderRadius: radius.lg, overflow: "hidden", background: "#0a0c11" }}
    />
  );
}
