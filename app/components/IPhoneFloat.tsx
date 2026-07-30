'use client'

import { useRef, useEffect, useMemo, Suspense, Component, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, Float, RoundedBox, useTexture, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'

/* Path to a real iPhone model. Drop a file here and it auto-loads; until then
   the procedural fallback renders. Get a free GLB from Sketchfab/CGTrader. */
const MODEL_URL = '/iphone_14_pro.glb'

/* ── The phone model ─────────────────────────────────────────────
   A procedural iPhone: titanium frame (RoundedBox, full metalness),
   a glass screen showing a brand frame as an emissive map, a Dynamic
   Island, side buttons, and a back camera bump with three lenses.
   The realism comes from the Environment lightformers below — metal
   only looks like metal when it has something to reflect. */
function ProceduralPhone({ scrollRef }: { scrollRef: React.MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null)

  // brand frame used as the on-screen wallpaper
  const screen = useTexture('/hero-frames/frame0040.webp')
  screen.colorSpace = THREE.SRGBColorSpace

  useFrame((_, delta) => {
    if (!group.current) return
    // ease the spin toward the scroll-driven target
    group.current.rotation.y = THREE.MathUtils.damp(
      group.current.rotation.y,
      scrollRef.current,
      3.5,
      delta
    )
  })

  const W = 1, H = 2.05, D = 0.13, R = 0.2

  return (
    <Float speed={1.6} rotationIntensity={0.35} floatIntensity={0.9}>
      <group ref={group} rotation={[0.12, -0.5, 0]}>
        {/* titanium body */}
        <RoundedBox args={[W, H, D]} radius={R} smoothness={8} creaseAngle={0.5}>
          <meshPhysicalMaterial
            color="#4a4a4d"
            metalness={1}
            roughness={0.38}
            clearcoat={0.6}
            clearcoatRoughness={0.4}
          />
        </RoundedBox>

        {/* glass screen — emissive so the wallpaper glows like a real display */}
        <RoundedBox
          args={[W - 0.08, H - 0.08, D]}
          radius={R - 0.04}
          smoothness={8}
          position={[0, 0, 0.005]}
        >
          <meshPhysicalMaterial
            map={screen}
            emissiveMap={screen}
            emissive="#ffffff"
            emissiveIntensity={0.85}
            roughness={0.12}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.05}
          />
        </RoundedBox>

        {/* Dynamic Island */}
        <mesh position={[0, H / 2 - 0.16, 0.068]}>
          <boxGeometry args={[0.26, 0.07, 0.01]} />
          <meshStandardMaterial color="#000000" roughness={0.4} />
        </mesh>

        {/* side buttons */}
        <mesh position={[-W / 2 - 0.005, 0.35, 0]}>
          <boxGeometry args={[0.02, 0.18, 0.07]} />
          <meshStandardMaterial color="#3a3a3c" metalness={1} roughness={0.4} />
        </mesh>
        <mesh position={[-W / 2 - 0.005, 0.08, 0]}>
          <boxGeometry args={[0.02, 0.18, 0.07]} />
          <meshStandardMaterial color="#3a3a3c" metalness={1} roughness={0.4} />
        </mesh>
        <mesh position={[W / 2 + 0.005, 0.2, 0]}>
          <boxGeometry args={[0.02, 0.26, 0.07]} />
          <meshStandardMaterial color="#3a3a3c" metalness={1} roughness={0.4} />
        </mesh>

        {/* ── back camera bump ── */}
        <group position={[-0.26, H / 2 - 0.34, -D / 2 - 0.04]}>
          <RoundedBox args={[0.5, 0.5, 0.08]} radius={0.14} smoothness={6}>
            <meshPhysicalMaterial color="#3a3a3c" metalness={1} roughness={0.45} clearcoat={0.5} />
          </RoundedBox>
          {/* three lenses */}
          {([[-0.1, 0.1], [0.1, 0.1], [-0.1, -0.1]] as const).map(([x, y], i) => (
            <group key={i} position={[x, y, -0.05]}>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.085, 0.095, 0.06, 32]} />
                <meshPhysicalMaterial color="#0a0a0e" metalness={0.9} roughness={0.25} clearcoat={1} />
              </mesh>
              <mesh position={[0, 0, -0.025]}>
                <circleGeometry args={[0.05, 32]} />
                <meshPhysicalMaterial color="#05050a" metalness={0.2} roughness={0.1} clearcoat={1} />
              </mesh>
            </group>
          ))}
          {/* flash */}
          <mesh position={[0.1, -0.1, -0.04]}>
            <circleGeometry args={[0.035, 24]} />
            <meshStandardMaterial color="#fff3d0" emissive="#fff0c0" emissiveIntensity={0.3} />
          </mesh>
        </group>
      </group>
    </Float>
  )
}

/* ── Real GLTF model loader ──────────────────────────────────────
   Loads MODEL_URL, auto-centers and scales it to a consistent height,
   then applies the same float + scroll-spin as the procedural phone.
   If the file is missing/broken, useGLTF throws and the ErrorBoundary
   below swaps in the procedural fallback. */
// ── tunables ──────────────────────────────────────────────────
const PHONE_HEIGHT = 1.5   // overall size in world units (lower = smaller)
const SCREEN_INSET = 0.93  // screen plane as fraction of phone face (bezels)
const FRONT_Z_SIGN = 1     // flip to -1 if the UI lands on the back face
// HTML UI canvas — px sets internal resolution/aspect (match phone face),
// UI_SCALE sets the on-screen size in world units (bigger = larger).
const UI_PX_W = 360
const UI_PX_H = 736        // ~ matches iPhone 19.5:9 screen ratio
const UI_SCALE = 0.09      // tweak this if the UI is too small / too big

function GLTFPhone({ scrollRef }: { scrollRef: React.MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null)
  const { scene } = useGLTF(MODEL_URL)

  // fit model + derive screen-plane geometry from its bounding box
  const { object, screen } = useMemo(() => {
    const obj = scene.clone(true)
    const box = new THREE.Box3().setFromObject(obj)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    const scale = PHONE_HEIGHT / (size.y || 1)

    // center the geometry inside a wrap, then scale the WRAP so scaling
    // happens around the centered origin (scaling obj directly would shove
    // it off in Z because its local origin isn't the geometry center)
    const wrap = new THREE.Group()
    obj.position.sub(center)
    wrap.add(obj)
    wrap.scale.setScalar(scale)

    // front glass position in wrap-parent (world-ish) space after scaling
    const frontZ = ((box.max.z - center.z) * scale + 0.01) * FRONT_Z_SIGN
    return {
      object: wrap,
      screen: {
        w: size.x * scale * SCREEN_INSET,
        h: size.y * scale * SCREEN_INSET,
        z: frontZ,
      },
    }
  }, [scene])

  useFrame((_, delta) => {
    if (!group.current) return
    group.current.rotation.y = THREE.MathUtils.damp(
      group.current.rotation.y,
      scrollRef.current,
      3.5,
      delta
    )
  })

  return (
    <Float speed={1.6} rotationIntensity={0.35} floatIntensity={0.9}>
      <group ref={group} rotation={[0.12, -0.5, 0]}>
        <primitive object={object} />

        {/* dark glass base behind the UI so the screen reads as "on" */}
        <mesh position={[0, 0, screen.z - 0.004]}>
          <planeGeometry args={[screen.w, screen.h]} />
          <meshStandardMaterial color="#000000" roughness={0.08} metalness={0} />
        </mesh>

        {/* live HTML UI — real DOM mapped onto the screen. scale prop converts
            px → world units (drei transform mode renders 1px = 1 unit). occlude
            is OFF for now; re-enable once we confirm the screen faces forward. */}
        <Html
          transform
          position={[0, 0, screen.z]}
          scale={UI_SCALE}
          style={{
            width: `${UI_PX_W}px`,
            height: `${UI_PX_H}px`,
            pointerEvents: 'none',
          }}
        >
            <div className="phone-ui">
              <div className="phone-ui-status">
                <span>9:41</span>
                <span className="phone-ui-status-icons">
                  <i className="pu-sig" /><i className="pu-wifi" /><i className="pu-bat" />
                </span>
              </div>

              <div className="phone-ui-header">
                <div className="phone-ui-logo">MD</div>
                <div className="phone-ui-title">MD Media</div>
              </div>

              <div className="phone-ui-card">
                <div className="phone-ui-card-img" />
                <div className="phone-ui-card-actions">
                  <i className="pu-heart" /><i className="pu-cmt" /><i className="pu-send" />
                </div>
                <div className="phone-ui-card-cap">
                  <b>mdmedia</b> Strategy that converts. Content that captures.
                </div>
              </div>

              <div className="phone-ui-stat">
                <div className="phone-ui-stat-row">
                  <span>Reach</span><span>+312%</span>
                </div>
                <div className="phone-ui-bar"><i style={{ width: '82%' }} /></div>
              </div>

              <div className="phone-ui-tabbar">
                <i className="pu-tab pu-tab--on" /><i className="pu-tab" /><i className="pu-tab" /><i className="pu-tab" />
              </div>
            </div>
          </Html>
      </group>
    </Float>
  )
}

/* Catches the load error when MODEL_URL is absent → renders fallback */
class ModelErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export default function IPhoneFloat() {
  const scrollRef = useRef(0)

  useEffect(() => {
    const handler = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? window.scrollY / max : 0
      scrollRef.current = p * Math.PI * 4 // two full spins across the page
    }
    window.addEventListener('scroll', handler, { passive: true })
    handler()
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <div className="iph-canvas-wrap" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 28 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.4} />

        {/* try the real model; fall back to procedural if the file is absent */}
        <ModelErrorBoundary
          fallback={
            <Suspense fallback={null}>
              <ProceduralPhone scrollRef={scrollRef} />
            </Suspense>
          }
        >
          <Suspense fallback={null}>
            <GLTFPhone scrollRef={scrollRef} />
          </Suspense>
        </ModelErrorBoundary>

        {/* studio reflections — built from light cards, no external HDRI needed */}
        <Suspense fallback={null}>
          <Environment resolution={256}>
            <Lightformer intensity={2} position={[0, 2, 3]} scale={[6, 6, 1]} color="#bcd4ff" />
            <Lightformer intensity={3} position={[3, 0, 2]} scale={[3, 6, 1]} color="#ffffff" />
            <Lightformer intensity={1.5} position={[-3, -1, 2]} scale={[3, 6, 1]} color="#3a78ff" />
            <Lightformer intensity={2} position={[0, -2, 1]} scale={[6, 3, 1]} color="#0a1840" />
          </Environment>
        </Suspense>
      </Canvas>
    </div>
  )
}
