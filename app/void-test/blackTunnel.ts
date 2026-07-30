import * as THREE from 'three'
import { loadBuf } from './bufLoader'

/**
 * Port of Lusion's GoalBlackTunnel — the techno-grid tunnel, VERBATIM.
 *
 * grid_base modules instanced at grid_structure points (both ld+hd), run
 * through their exact vertex shader: per-block random orientation, height
 * scaling, time wobble, assembly-from-center via u_showRatio, u_offsetZ
 * scroll-wrap, and the goalBlackTunnelTransform sphere-inversion that bends
 * the whole grid around the (static) camera. Fragment: greeble armb/normal
 * textures, feedback-texture diffuse boost, COLOR_1/COLOR_2 stepped grading,
 * emissive strips, bloom written to alpha.
 */

export const GRID_SIZE = 20
const COLOR_1 = ['#0d2b27', '#ba0000', '#00b5a6', '#0099ff']
const COLOR_2 = ['#8c8c8c', '#008e6b', '#7e7f05', '#ff0000']

const TRANSFORM = /* glsl */ `
uniform float u_blackTunnelTransformRatio;
vec3 goalBlackTunnelTransform(vec3 pos){float t=u_blackTunnelTransformRatio*6.2831853;float zWeight=pos.z*0.025;float angle=t*zWeight*zWeight*sign(zWeight);float sa=sin(angle);float ca=cos(angle);mat2 m2=mat2(ca,-sa,sa,ca);pos.xy=m2*pos.xy;pos.z+=t*1.;pos=pos.xzy;float rad=20.;pos/=rad;vec3 a=pos;vec2 pq=vec2(-1.,.5)*t;float ada=dot(a,a);vec4 b=vec4(2.*a,ada-1.)/(1.+ada);vec4 pq_cs=vec4(cos(pq),sin(pq)).xzyw;vec2 np1=vec2(-1.,1.);vec4 c=(b.xxyy*np1.yxyy*pq_cs+b.zzww*np1.yyxy*pq_cs.yxwz).xzyw;pos=c.xyz/(1.-c.w);pos=pos.xzy;return pos*rad;}
`

const vertexShader = /* glsl */ `
attribute float ao;
attribute float areaRatio;
attribute float cluster;
attribute float height;
attribute vec3 center;
attribute vec3 instancePos;
attribute vec3 instanceGridIds;
attribute vec3 instanceAxis;
attribute vec4 tangent;
uniform float u_time;
uniform float u_showRatio;
uniform float u_offsetZ;
varying vec3 v_worldPosition;
varying vec4 v_worldTangent;
varying vec3 v_worldNormal;
varying float v_ao;
varying float v_opacity;
varying float v_emission;
varying vec2 v_uv;
varying vec4 v_rands;
varying float v_depth;
#define PI 3.14159265359
vec3 qrotate(vec4 q,vec3 v){return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
vec4 quaternion(vec3 axis,float angle){float halfAngle=angle*0.5;return vec4(axis*sin(halfAngle),cos(halfAngle));}
float linearStep(float edge0,float edge1,float x){return clamp((x-edge0)/(edge1-edge0),0.0,1.0);}
vec4 hash44(vec4 p4){p4=fract(p4*vec4(.1031,.1030,.0973,.1099));p4+=dot(p4,p4.wzxy+33.33);return fract((p4.xxyz+p4.yzzw)*p4.zywx);}
vec3 inverseTransformDirection(in vec3 dir,in mat4 matrix){return normalize((vec4(dir,0.0)*matrix).xyz);}
${TRANSFORM}
void main(){
vec3 pos=position;vec3 nor=normal;vec3 tang=tangent.xyz;
#ifdef IS_HD
float blockId=floor(pos.x+0.5);
#else
float blockId=0.;
#endif
vec4 q;vec3 offsetInstanceGridIds=instanceGridIds;offsetInstanceGridIds.z-=floor(u_offsetZ/float(GRID_SIZE))*2.;vec4 instanceRand1s=hash44(floor(vec4(offsetInstanceGridIds+.5,blockId+cluster)));v_rands=hash44(floor(vec4(offsetInstanceGridIds+.5,100.0)));float showRatio=u_showRatio;showRatio*=1.-step(10.5,instanceGridIds.z)*mod(u_offsetZ/float(GRID_SIZE),1.);
#ifdef IS_HD
pos=mix(center,pos,showRatio);
#else
pos.xy*=showRatio*showRatio;pos.z*=showRatio;
#endif
#ifdef IS_HD
pos.x-=blockId;float blockOffset=sin(u_time*2.+cos(u_time*4.+0.2+offsetInstanceGridIds.z))*0.15*instanceRand1s.y;float heightRatio=1.;pos.y=pos.y*height*heightRatio+(0.025+blockOffset);float variation=floor(instanceRand1s.x*8.);q=quaternion(vec3(0.,0.,variation>3.5 ?-1. : 1.),(mod(blockId,4.)+mod(variation,4.))*PI*0.5);pos=qrotate(q,pos);nor=qrotate(q,nor);tang=qrotate(q,tang);
#endif
q=quaternion(instanceAxis,PI*0.5);pos=qrotate(q,pos)*float(GRID_SIZE)+instancePos;nor=qrotate(q,nor);tang=qrotate(q,tang);pos.z+=mod(u_offsetZ,float(GRID_SIZE));v_depth=-pos.z;pos=goalBlackTunnelTransform(pos);
#ifdef IS_HD
v_ao=ao;v_emission=areaRatio<0.25 ? sin(pos.z*0.25-u_time)*0.5+0.5 : 0.;
#else
v_ao=1.;v_emission=0.;
#endif
v_opacity=linearStep(57.,30.,length(pos.xy))*linearStep(5.+100.,5.+100.-20.,cameraPosition.z-pos.z);v_worldPosition=(modelMatrix*vec4(pos,1.0)).xyz;v_worldTangent=vec4(inverseTransformDirection(normalMatrix*tang,viewMatrix),tangent.w);v_worldNormal=inverseTransformDirection(normalMatrix*nor,viewMatrix);v_uv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);}
`

const fragmentShader = /* glsl */ `
uniform sampler2D u_feedbackTexture;
uniform sampler2D u_greebleArmbTexture;
uniform sampler2D u_greebleNormalTexture;
uniform vec2 u_resolution;
uniform vec3 u_outBloomFromToStrength;
uniform vec3 u_color1;
uniform vec3 u_color2;
varying vec3 v_worldPosition;
varying vec4 v_worldTangent;
varying vec3 v_worldNormal;
varying vec4 v_rands;
varying float v_ao;
varying float v_opacity;
varying float v_emission;
varying float v_depth;
varying vec2 v_uv;
float linearStep(float edge0,float edge1,float x){return clamp((x-edge0)/(edge1-edge0),0.0,1.0);}
void main(){vec2 screenUv=gl_FragCoord.xy/u_resolution;float faceDirection=gl_FrontFacing ? 1.0 :-1.0;vec3 worldNormal=normalize(v_worldNormal)*faceDirection;vec3 worldTangent=normalize(v_worldTangent.xyz)*faceDirection;vec3 worldBinormal=normalize(cross(worldNormal,worldTangent))*-v_worldTangent.w;worldTangent=normalize(cross(worldBinormal,worldNormal));vec3 tangentSpaceNormal=normalize(texture2D(u_greebleNormalTexture,v_uv).xyz-.5);worldNormal=normalize(tangentSpaceNormal.x*worldTangent+tangentSpaceNormal.y*worldBinormal+tangentSpaceNormal.z*worldNormal);vec4 armb=texture2D(u_greebleArmbTexture,v_uv);float ao=v_ao*armb.r;vec3 lightPos=vec3(0.0,-0.0,-100.0);vec3 toLight=normalize(lightPos-v_worldPosition);float diffuse=(dot(worldNormal,toLight)*0.5+0.5);
#ifdef IS_HD
float feedbackMultiplier=2.5;
#else
float feedbackMultiplier=2.0;
#endif
vec3 color1=u_color1;vec3 color2=u_color2;vec3 baseColor=0.5+mix(color1,color2,v_rands.x)*1.2;vec3 emissiveColor=mix(color1,color2,v_rands.y)*3.5;diffuse*=(0.5+texture2D(u_feedbackTexture,screenUv+worldNormal.xy*0.02).r*feedbackMultiplier);gl_FragColor.rgb=baseColor*vec3(ao*0.75*diffuse)+emissiveColor*v_emission;gl_FragColor.rgb*=v_opacity;float endBloomStrength=linearStep(u_outBloomFromToStrength.x,u_outBloomFromToStrength.y,v_depth)*u_outBloomFromToStrength.z;float bloomScale=linearStep(5.0,20.0,v_depth)*(1.0-linearStep(15.0,25.0,length(v_worldPosition.xy)));gl_FragColor.a=bloomScale*max(0.,dot(gl_FragColor.rgb,vec3(.299,.587,.114))*2.5-1.)+endBloomStrength*0.75;gl_FragColor.rgb+=endBloomStrength*(0.35+gl_FragColor.rgb*0.65);}
`

// maths helpers matching their lib
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)
const cUnMix = (a: number, b: number, x: number) => clamp01((x - a) / (b - a))
const fitE = (v: number, a: number, b: number, o0: number, o1: number, e?: (t: number) => number) => {
  let t = clamp01((v - a) / (b - a))
  if (e) t = e(t)
  return o0 + (o1 - o0) * t
}
const expoIn = (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1)))
const sineIn = (t: number) => 1 - Math.cos((t * Math.PI) / 2)
const cubicInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export type BlackTunnel = {
  container: THREE.Group
  uniforms: Record<string, THREE.IUniform>
  /** returns their dolly-zoom fov offset for this frame */
  update: (dt: number, ratio: number, time: number, scrollDir: number, active: boolean) => number
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })

export async function createBlackTunnel(assetBase: string): Promise<BlackTunnel> {
  const [baseHd, structHd, baseLd, structLd, armImg, baseImg] = await Promise.all([
    loadBuf(`${assetBase}/models/grid_base_hd.buf`),
    loadBuf(`${assetBase}/models/grid_structure_hd.buf`),
    loadBuf(`${assetBase}/models/grid_base_ld.buf`),
    loadBuf(`${assetBase}/models/grid_structure_ld.buf`),
    loadImage(`${assetBase}/textures/greeble_arm.webp`),
    loadImage(`${assetBase}/textures/greeble_base.webp`),
  ])

  // their armb combine: rgb = arm.rgb, a = base.r
  const w = armImg.width, h = armImg.height
  const cnv = document.createElement('canvas')
  cnv.width = w; cnv.height = h
  const ctx = cnv.getContext('2d')!
  ctx.drawImage(armImg, 0, 0)
  const armData = ctx.getImageData(0, 0, w, h)
  ctx.drawImage(baseImg, 0, 0, w, h)
  const baseData = ctx.getImageData(0, 0, w, h)
  for (let i = 0; i < armData.data.length; i += 4) armData.data[i + 3] = baseData.data[i]
  ctx.putImageData(armData, 0, 0)
  const armbTex = new THREE.CanvasTexture(cnv)
  armbTex.wrapS = armbTex.wrapT = THREE.RepeatWrapping
  armbTex.flipY = false

  const norTex = new THREE.TextureLoader().load(`${assetBase}/textures/greeble_nor.webp`)
  norTex.wrapS = norTex.wrapT = THREE.RepeatWrapping
  norTex.flipY = false

  // feedback stub (their real one is a copy of last frame at quarter res)
  const fb = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255]), 1, 1)
  fb.needsUpdate = true

  const uniforms: Record<string, THREE.IUniform> = {
    u_time: { value: 0 },
    u_showRatio: { value: 0 },
    u_offsetZ: { value: 0 },
    u_blackTunnelTransformRatio: { value: 0 },
    u_outBloomFromToStrength: { value: new THREE.Vector3(0, 70, 0) },
    u_feedbackTexture: { value: fb },
    u_greebleArmbTexture: { value: armbTex },
    u_greebleNormalTexture: { value: norTex },
    u_color1: { value: new THREE.Color() },
    u_color2: { value: new THREE.Color() },
    u_resolution: { value: new THREE.Vector2(1, 1) },
  }

  const container = new THREE.Group()
  const variants: [typeof baseHd, typeof structHd, boolean][] = [
    [baseLd, structLd, false],
    [baseHd, structHd, true],
  ]
  for (const [base, struct, isHd] of variants) {
    const geo = new THREE.InstancedBufferGeometry()
    for (const name of ['position', 'normal', 'uv', 'tangent']) {
      const a = base.geometry.getAttribute(name)
      if (a) geo.setAttribute(name, a)
    }
    if (base.geometry.getIndex()) geo.setIndex(base.geometry.getIndex())
    // their extra per-vertex streams
    const addStream = (id: string, size: number) => {
      const s = base.streams[id]
      if (!s) return
      const arr = s instanceof Float32Array ? s : Float32Array.from(s as Uint8Array, (v) => v / 255)
      geo.setAttribute(id, new THREE.BufferAttribute(arr, size))
    }
    addStream('ao', 1)
    addStream('areaRatio', 1)
    addStream('cluster', 1)
    addStream('height', 1)
    addStream('center', 3)
    // instance streams from the structure points
    const ipos = struct.streams.position as Float32Array
    const iids = struct.streams.gridIds
    const iaxis = struct.streams.rotAxis as Float32Array
    geo.setAttribute('instancePos', new THREE.InstancedBufferAttribute(ipos, 3))
    geo.setAttribute(
      'instanceGridIds',
      new THREE.InstancedBufferAttribute(
        iids instanceof Float32Array ? iids : Float32Array.from(iids as Uint8Array),
        3,
      ),
    )
    geo.setAttribute('instanceAxis', new THREE.InstancedBufferAttribute(iaxis, 3))
    geo.instanceCount = ipos.length / 3

    const mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
        defines: { GRID_SIZE: GRID_SIZE.toFixed(0), ...(isHd ? { IS_HD: true } : {}) },
      }),
    )
    mesh.frustumCulled = false
    mesh.renderOrder = isHd ? 2 : 1
    container.add(mesh)
  }

  // their update() state
  let pulseTime = 0
  let linearTime = 0
  const c1 = new THREE.Color()
  const c2 = new THREE.Color()

  const update = (dt: number, ratio: number, time: number, scrollDir: number, active: boolean) => {
    container.visible = active
    if (!active) return 0
    container.position.z = -80 * cUnMix(0.2, 0, ratio)
    uniforms.u_time.value = time
    uniforms.u_showRatio.value = expoIn(cUnMix(0, 0.1, ratio))

    const l = uniforms.u_outBloomFromToStrength.value as THREE.Vector3
    l.z = fitE(ratio, 0.65, 0.75, 0, 0.2)
    l.z = fitE(ratio, 0.75, 0.85, l.z, 0.15)
    l.z = fitE(ratio, 0.85, 1, l.z, 0.15)
    l.x = fitE(ratio, 0.75, 0.85, 20, 60)
    l.x = fitE(ratio, 0.9, 1, l.x, 30)

    const c = fitE(ratio, 0.6, 1, 0, 1, sineIn)
    uniforms.u_blackTunnelTransformRatio.value = c

    const u = scrollDir * dt
    pulseTime += u * cUnMix(0.1, 0.3, ratio) * fitE(c, 0, 0.25, 1, 0.5)
    linearTime += u * fitE(c, 0, 0.25, 1.5, 1)
    const f = pulseTime
    const pfl = Math.floor(f)
    const g = f - pfl
    uniforms.u_offsetZ.value =
      (pfl + cubicInOut(g)) * GRID_SIZE + linearTime * GRID_SIZE + ratio * GRID_SIZE * 10

    // stepped colour grading
    const T = COLOR_1.length * fitE(ratio, 0.2, 1, 0, 1)
    const M = Math.floor(T)
    const S = Math.min(Math.ceil(T), COLOR_1.length - 1)
    const b = T - M
    c1.set(COLOR_1[Math.min(M, COLOR_1.length - 1)])
    c2.set(COLOR_1[S])
    ;(uniforms.u_color1.value as THREE.Color).copy(b > 0.5 ? c2 : c1)
    c1.set(COLOR_2[Math.min(M, COLOR_2.length - 1)])
    c2.set(COLOR_2[S])
    ;(uniforms.u_color2.value as THREE.Color).copy(b > 0.5 ? c2 : c1)

    // their dolly-zoom wobble
    return Math.sin(ratio * 10 + time) * 7.5 * smoothstep(0, 0.2, ratio)
  }

  return { container, uniforms, update }
}
