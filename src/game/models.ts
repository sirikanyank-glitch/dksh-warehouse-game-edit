import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Assets } from '../engine/assets'

/**
 * Runtime model table. Production loads the registered Storage/CDN copies; the dev server
 * reads the local working copies (restored from assets.lock.json) so Preview works offline.
 */
/** Model files live in public/models and are copied as-is into the build. */
const BASE = import.meta.env.BASE_URL
export const MODEL_URLS = {
  worker: BASE + 'models/worker_dksh_animated.glb',
  forklift: BASE + 'models/forklift.glb',
  jack: BASE + 'models/pallet_jack.glb',
  truck: BASE + 'models/inbound_truck.glb',
  container: BASE + 'models/container.glb',
  pallet: BASE + 'models/pallet.glb',
  carton: BASE + 'models/carton.glb',
} as const
export type ModelKey = keyof typeof MODEL_URLS
export type Models = Record<ModelKey, GLTF>

export async function loadModels(assets: Assets, onProgress: (f: number) => void): Promise<Models> {
  const keys = Object.keys(MODEL_URLS) as ModelKey[]
  let done = 0
  const out = await Promise.all(keys.map(k => assets.gltf(MODEL_URLS[k]).then(g => { onProgress(++done / keys.length); return g })))
  return Object.fromEntries(keys.map((k, i) => [k, out[i]])) as Models
}

/** Soften generated materials: no unlit glare, consistent roughness floor, proper shadows. */
export function prepMaterials(root: THREE.Object3D, rough = 0.8, metal = 0): void {
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.receiveShadow = true
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of mats) {
      const s = mat as THREE.MeshStandardMaterial
      if (!s.isMeshStandardMaterial) continue
      s.roughness = Math.max(rough, s.roughness ?? rough)
      s.metalness = Math.min(s.metalness ?? 0, metal)
      if (s.map) s.map.anisotropy = 4
    }
  })
}

/**
 * Wrap `obj` so it faces +Z (yaw applied), sits on y=0, is centred in x/z and scaled to `size`.
 * Missing axes keep the uniform scale implied by the given ones.
 */
export function fit(obj: THREE.Object3D, yaw: number, size: { x?: number; y?: number; z?: number }, uniform = false): THREE.Group {
  const inner = new THREE.Group()
  inner.rotation.y = yaw
  inner.add(obj)
  const outer = new THREE.Group()
  outer.add(inner)
  inner.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(inner)
  const s = b.getSize(new THREE.Vector3())
  const sx = size.x ? size.x / s.x : 0, sy = size.y ? size.y / s.y : 0, sz = size.z ? size.z / s.z : 0
  const any = sx || sy || sz || 1
  const u = uniform ? Math.min(...[sx, sy, sz].filter(Boolean)) || 1 : 0
  const scale = uniform ? new THREE.Vector3(u, u, u) : new THREE.Vector3(sx || any, sy || any, sz || any)
  const c = b.getCenter(new THREE.Vector3())
  inner.position.set(-c.x * scale.x, -b.min.y * scale.y, -c.z * scale.z)
  // Box is measured in outer-local space before outer scaling, so centre with raw offsets.
  inner.position.set(-c.x, -b.min.y, -c.z)
  outer.scale.copy(scale)
  return outer
}

/**
 * Drop triangles of a static mesh whose centroid satisfies `drop` (geometry-space test). Used to
 * remove the generated forklift's fixed forks and the container roof.
 */
export function cullTriangles(root: THREE.Object3D, drop: (c: THREE.Vector3, box: THREE.Box3) => boolean): void {
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const g = m.geometry as THREE.BufferGeometry
    g.computeBoundingBox()
    const box = g.boundingBox!
    const pos = g.getAttribute('position')
    const idx = g.getIndex()
    const n = idx ? idx.count : pos.count
    const keep: number[] = []
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2)
      a.add(b).add(c).multiplyScalar(1 / 3)
      if (!drop(a, box)) keep.push(i0, i1, i2)
    }
    const ng = g.clone()
    ng.setIndex(keep)
    m.geometry = ng
  })
}

/** First mesh's geometry + material, for InstancedMesh use of static props (pallet, carton). */
export function meshParts(root: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material } {
  let found: THREE.Mesh | undefined
  root.updateMatrixWorld(true)
  root.traverse(o => { if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh })
  if (!found) throw new Error('model has no mesh')
  const geometry = (found.geometry as THREE.BufferGeometry).clone().applyMatrix4(found.matrixWorld)
  return { geometry, material: found.material as THREE.Material }
}
