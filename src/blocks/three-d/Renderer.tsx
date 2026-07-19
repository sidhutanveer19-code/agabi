"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { ThreeDData } from "./schema";

function Shape({ shape, color }: ThreeDData) {
  return (
    <mesh rotation={[0.4, 0.2, 0]}>
      {shape === "box" ? (
        <boxGeometry args={[1.4, 1.4, 1.4]} />
      ) : shape === "sphere" ? (
        <sphereGeometry args={[1, 48, 48]} />
      ) : (
        <torusGeometry args={[1, 0.4, 28, 90]} />
      )}
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.3} />
    </mesh>
  );
}

export function Renderer({ data }: BlockRendererProps<ThreeDData>) {
  return (
    <div style={{ height: 320, borderRadius: radius.lg, overflow: "hidden", background: "#0a0c11" }}>
      <Canvas camera={{ position: [0, 0, 4] }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 5]} intensity={1.2} />
        <Shape shape={data.shape} color={data.color} />
        <OrbitControls autoRotate autoRotateSpeed={2.2} enablePan={false} />
      </Canvas>
    </div>
  );
}
