'use client'

import { useRef, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/* ── Exact reactbits.dev/backgrounds/silk shaders ──────────────── */
const vertexShader = /* glsl */`
  varying vec2 vUv;
  varying vec3 vPosition;

  void main() {
    vPosition = position;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */`
  precision highp float;

  varying vec2 vUv;
  varying vec3 vPosition;

  uniform float uTime;
  uniform vec3  uColor;
  uniform float uSpeed;
  uniform float uScale;
  uniform float uRotation;
  uniform float uNoiseIntensity;

  const float e = 2.71828182845904523536;

  float noise(vec2 texCoord) {
    float G = e;
    vec2  r = (G * sin(G * texCoord));
    return fract(r.x * r.y * (1.0 + texCoord.x));
  }

  vec2 rotateUvs(vec2 uv, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    mat2  rot = mat2(c, -s, s, c);
    return rot * uv;
  }

  void main() {
    float rnd     = noise(gl_FragCoord.xy);
    vec2  uv      = rotateUvs(vUv * uScale, uRotation);
    vec2  tex     = uv * uScale;
    float tOffset = uSpeed * uTime;

    tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

    float pattern = 0.6 +
                    0.4 * sin(5.0 * (tex.x + tex.y +
                                     cos(3.0 * tex.x + 5.0 * tex.y) +
                                     0.02 * tOffset) +
                             sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

    vec4 col = vec4(uColor, 1.0) * vec4(pattern) - rnd / 15.0 * uNoiseIntensity;
    col.a = 1.0;
    gl_FragColor = col;
  }
`

/* ── Inner mesh (needs fiber context) ─────────────────────────── */
function SilkMesh({ speed, scale, color, noiseIntensity, rotation }: {
  speed: number; scale: number; color: string; noiseIntensity: number; rotation: number
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const { viewport } = useThree()

  const uniforms = useMemo(() => ({
    uTime:           { value: 0 },
    uColor:          { value: new THREE.Color(color) },
    uSpeed:          { value: speed },
    uScale:          { value: scale },
    uRotation:       { value: rotation },
    uNoiseIntensity: { value: noiseIntensity },
  }), [color, speed, scale, rotation, noiseIntensity])

  useFrame((state) => {
    if (matRef.current) {
      // drive directly from the render clock so it can never "stall"
      matRef.current.uniforms.uTime.value = state.clock.getElapsedTime()
    }
  })

  return (
    <mesh scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1, 1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  )
}

/* ── Public component ──────────────────────────────────────────── */
interface Props {
  speed?:          number
  scale?:          number
  color?:          string
  noiseIntensity?: number
  rotation?:       number
  style?:          React.CSSProperties
}

export default function SilkBackground({
  speed          = 0.5,
  scale          = 1,
  color          = '#5d5fef',
  noiseIntensity = 1.5,
  rotation       = 0,
  style,
}: Props) {
  return (
    <div style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      background: '#2a2540',
      ...style,
    }}>
      <Canvas
        dpr={[1, 2]}
        frameloop="always"
        gl={{ antialias: true, alpha: false }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <SilkMesh
          speed={speed}
          scale={scale}
          color={color}
          noiseIntensity={noiseIntensity}
          rotation={rotation}
        />
      </Canvas>
    </div>
  )
}
