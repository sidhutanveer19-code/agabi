"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import "three";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color } from "@/config/tokens";

export type ShapeType = "box" | "sphere" | "cylinder" | "cone" | "torus";

export interface Shape {
  type: ShapeType;
  args?: number[];
  color?: string;
  position?: [number, number, number];
}

export interface ThreedData {
  shapes: Shape[];
}

/** Default geometry args per primitive when a shape omits `args`. */
const DEFAULT_ARGS: Record<ShapeType, number[]> = {
  box: [1, 1, 1],
  sphere: [0.7, 32, 32],
  cylinder: [0.5, 0.5, 1.4, 32],
  cone: [0.6, 1.4, 32],
  torus: [0.6, 0.22, 24, 64],
};

function ShapeMesh({ shape }: { shape: Shape }) {
  const args = (shape.args ?? DEFAULT_ARGS[shape.type]) as number[];
  const meshColor = shape.color ?? color.violet2;
  const position = shape.position ?? [0, 0, 0];
  return (
    <mesh position={position}>
      {shape.type === "box" ? <boxGeometry args={args as [number, number, number]} /> : null}
      {shape.type === "sphere" ? <sphereGeometry args={args as [number, number, number]} /> : null}
      {shape.type === "cylinder" ? <cylinderGeometry args={args as [number, number, number, number]} /> : null}
      {shape.type === "cone" ? <coneGeometry args={args as [number, number, number]} /> : null}
      {shape.type === "torus" ? <torusGeometry args={args as [number, number, number, number]} /> : null}
      <meshStandardMaterial color={meshColor} roughness={0.45} metalness={0.15} />
    </mesh>
  );
}

/**
 * React Three Fiber scene renderer (lazy-loaded). Orbit is always enabled so the
 * scene reads the same in present + edit; the block only stores its `shapes`.
 */
export default function ThreedRenderer({ block }: BlockRendererProps<ThreedData>) {
  const data = block.data ?? { shapes: [] };
  const shapes = data.shapes ?? [];

  return (
    <div
      role="img"
      aria-label={`3D scene with ${shapes.length} shape${shapes.length === 1 ? "" : "s"}`}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.bg,
      }}
    >
      <Canvas camera={{ position: [3, 3, 3] }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.1} />
        {shapes.map((shape, i) => (
          <ShapeMesh key={i} shape={shape} />
        ))}
        <OrbitControls enablePan={false} />
      </Canvas>
    </div>
  );
}
