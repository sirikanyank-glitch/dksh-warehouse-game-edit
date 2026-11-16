import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { FORK_REST, LVY, PLAYER_COLORS, RACK_Z, RK, bayX, laneX, slotPos } from './layout'
import { cullTriangles, fit, meshParts, prepMaterials, type Models } from './models'
import type { Player, Target } from './sim'
import { box, canvasTex, FONT, mat } from './world'

/** Aim `bone` so its child points along `dir` (world space), blended by `w`. Axis-agnostic. */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion()
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3, w: number): void {
  bone.getWorldPosition(_a)
  child.getWorldPosition(_b)
  const cur = _b.sub(_a).normalize()
  _q.setFromUnitVectors(cur, dir)
  bone.getWorldQuaternion(_wq)
  _wq.premultiply(_q)
  bone.parent!.getWorldQuaternion(_pq)
  _wq.premultiply(_pq.invert())
  bone.quaternion.slerp(_wq, w)
  bone.updateMatrixWorld(true)
}

type Pose = 'free' | 'carry' | 'push' | 'drive'

/** Pose between the last two fixed simulation steps, so motion stays smooth on 60/90/120 Hz screens. */
export function blendPose(p: Player, alpha: number): { x: number; z: number; ang: number } {
  const a = Math.max(0, Math.min(1, alpha))
  let d = p.ang - p.pang
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return { x: p.pz === undefined ? p.x : p.px + (p.x - p.px) * a, z: p.pz === undefined ? p.z : p.pz + (p.z - p.pz) * a, ang: p.pang + d * a }
}

class Worker {
  readonly root = new THREE.Group()
  private mixer: THREE.AnimationMixer
  private idle: THREE.AnimationAction
  private walk: THREE.AnimationAction
  private bones: Record<string, THREE.Object3D> = {}
  readonly carton: THREE.Object3D
  private moveW = 0

  constructor(models: Models, cartonSrc: THREE.Object3D) {
    const src = cloneSkinned(models.worker.scene)
    src.traverse(o => {
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o
      const m = o as THREE.SkinnedMesh
      if (m.isMesh) { m.castShadow = true; m.frustumCulled = false }
    })
    prepMaterials(src, 0.7)
    this.root.add(fit(src, -Math.PI / 2, { y: 1.74 }, true))
    addBrandDecals(this.root, src, this.bones)
    this.mixer = new THREE.AnimationMixer(src)
    const clips = models.worker.animations
    const walkClip = stripRootMotion(clips.find(c => c.name === 'walk')!)
    const idleClip = alignIdle(clips.find(c => c.name === 'idle')!, walkClip)
    this.idle = this.mixer.clipAction(idleClip)
    this.walk = this.mixer.clipAction(walkClip)
    this.idle.play(); this.walk.play()
    this.walk.setEffectiveWeight(0)
    this.carton = cartonSrc.clone(true)
    this.carton.position.set(0, 0.86, 0.42)
    this.carton.visible = false
    this.root.add(this.carton)
  }

  update(dt: number, speed: number, pose: Pose): void {
    const target = pose === 'drive' ? 0 : Math.min(1, speed / 1.2)
    this.moveW += (target - this.moveW) * Math.min(1, dt * 8)
    this.walk.setEffectiveWeight(this.moveW)
    this.idle.setEffectiveWeight(1 - this.moveW)
    // Stride matches ground speed (clip covers ~1.5 m per cycle at scale).
    this.walk.timeScale = THREE.MathUtils.clamp(speed / 1.6, 0.6, 2.2)
    this.mixer.update(dt)
    this.root.updateMatrixWorld(true)
    if (pose === 'free') return
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()))
    const down = new THREE.Vector3(0, -1, 0)
    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd)
    const B = this.bones
    const arms = (up: THREE.Vector3, fore: THREE.Vector3, spread: number) => {
      for (const [s, sign] of [['L', 1], ['R', -1]] as const) {
        const u = up.clone().addScaledVector(side, sign * spread).normalize()
        aim(B[`${s}_Upperarm`], B[`${s}_Forearm`], u, 1)
        aim(B[`${s}_Forearm`], B[`${s}_Hand`], fore.clone().addScaledVector(side, -sign * spread * 0.6).normalize(), 1)
      }
    }
    if (pose === 'carry') arms(fwd.clone().multiplyScalar(0.45).add(down).normalize(), fwd.clone().multiplyScalar(1).addScaledVector(down, -0.25).normalize(), 0.42)
    if (pose === 'push') arms(fwd.clone().multiplyScalar(0.75).add(down).normalize(), fwd.clone().addScaledVector(down, 0.15).normalize(), 0.2)
    if (pose === 'drive') {
      arms(fwd.clone().multiplyScalar(0.5).add(down).normalize(), fwd.clone().addScaledVector(down, 0.2).normalize(), 0.18)
      for (const [s, sign] of [['L', 1], ['R', -1]] as const) {
        aim(B[`${s}_Thigh`], B[`${s}_Calf`], fwd.clone().addScaledVector(down, 0.12).addScaledVector(side, sign * 0.12).normalize(), 1)
        aim(B[`${s}_Calf`], B[`${s}_Foot`], down.clone().addScaledVector(fwd, 0.25).normalize(), 1)
      }
    }
  }
}

/**
 * The generated walk clip carries root motion: the hip travels ~1.4 units forward over each 2.4 s
 * cycle and then snaps back when the clip loops, which reads as the worker jerking back and forth.
 * The game already moves the worker, so remove the linear drift on every horizontal hip axis and
 * keep only the natural sway.
 */
function stripRootMotion(src: THREE.AnimationClip): THREE.AnimationClip {
  const c = src.clone()
  const tr = c.tracks.find(t => t.name === 'Hip.position')
  if (!tr) return c
  const v = tr.values, times = tr.times, n = times.length
  if (n < 2) return c
  const t0 = times[0], span = times[n - 1] - t0 || 1
  // axis 2 is height in this rig; axes 0 and 1 are horizontal
  for (const ax of [0, 1]) {
    const first = v[ax], drift = v[(n - 1) * 3 + ax] - first
    if (Math.abs(drift) < 0.05) continue
    for (let i = 0; i < n; i++) v[i * 3 + ax] -= drift * ((times[i] - t0) / span)
  }
  return c
}

/** Move the idle clip's hip offset onto the walk clip's so crossfades do not slide sideways. */
function alignIdle(idle: THREE.AnimationClip, walk: THREE.AnimationClip): THREE.AnimationClip {
  const c = idle.clone()
  const wt = walk.tracks.find(t => t.name === 'Hip.position')
  const it = c.tracks.find(t => t.name === 'Hip.position')
  if (wt && it) {
    const dx = wt.values[0] - it.values[0], dz = wt.values[2] - it.values[2]
    for (let i = 0; i < it.values.length; i += 3) { it.values[i] += dx; it.values[i + 2] += dz }
  }
  return c
}

/** Shared static prop geometry + per-player factories. */
export class Kit {
  readonly cartonSrc: THREE.Object3D
  readonly palletParts: { geometry: THREE.BufferGeometry; material: THREE.Material }
  readonly cartonParts: { geometry: THREE.BufferGeometry; material: THREE.Material }
  private forkSrc: THREE.Object3D
  private jackSrc: THREE.Object3D

  constructor(readonly models: Models) {
    const carton = models.carton.scene
    prepMaterials(carton, 0.85)
    this.cartonSrc = fit(carton.clone(true), 0, { x: 0.52, y: 0.42, z: 0.47 })
    this.cartonParts = meshParts(this.cartonSrc)
    const pallet = models.pallet.scene
    prepMaterials(pallet, 0.85)
    this.palletParts = meshParts(fit(pallet.clone(true), Math.PI / 2, { x: 1.1, y: 0.15, z: 1.0 }))
    const fork = models.forklift.scene.clone(true)
    prepMaterials(fork, 0.55, 0.3)
    // Drop the generated model's fixed, lowered forks; a moving carriage replaces them.
    cullTriangles(fork, (c, b) => c.x > b.min.x + (b.max.x - b.min.x) * 0.64 && c.y < b.min.y + (b.max.y - b.min.y) * 0.2)
    this.forkSrc = fork
    const jack = models.jack.scene.clone(true)
    prepMaterials(jack, 0.5, 0.3)
    this.jackSrc = jack
  }

  forklift(color: string): { group: THREE.Group; car: THREE.Group; slot: THREE.Group; seat: THREE.Group } {
    const group = new THREE.Group()
    const body = fit(this.forkSrc.clone(true), -Math.PI / 2, { z: FORK_LEN }, true)
    const bb = new THREE.Box3().setFromObject(body)
    body.position.z = 0.74 - bb.max.z
    group.add(body)
    // player-colour beacon on the overhead guard (readable from the high camera)
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 16), mat(color, { emissive: color, emissiveIntensity: 0.8, roughness: 0.3 }))
    beacon.position.set(0, bb.max.y + 0.06, (bb.min.z + bb.max.z) / 2 + body.position.z - 0.15)
    group.add(beacon)
    const car = new THREE.Group(); car.position.set(0, FORK_REST, 0.8); group.add(car)
    box(0.84, 0.55, 0.06, mat('#3a4045', { roughness: 0.45, metalness: 0.6 }), 0, 0.3, 0, car)
    for (const y of [0.06, 0.52]) box(0.88, 0.06, 0.08, mat('#2a2f33', { metalness: 0.6, roughness: 0.4 }), 0, y, 0.02, car)
    const forkMat = mat('#9aa3a8', { metalness: 0.7, roughness: 0.35 })
    for (const s of [-1, 1]) {
      box(0.11, 0.045, 1.08, forkMat, s * 0.27, 0.0, 0.57, car)
      box(0.11, 0.5, 0.05, forkMat, s * 0.27, 0.25, 0.04, car)
    }
    const slot = new THREE.Group(); slot.position.set(0, 0.025, 0.54); car.add(slot)
    const seat = new THREE.Group(); seat.position.set(0, SEAT.y, SEAT.z); group.add(seat)
    return { group, car, slot, seat }
  }

  palletJack(color: string): { group: THREE.Group; slot: THREE.Group } {
    const group = new THREE.Group()
    const j = fit(this.jackSrc.clone(true), 0, { z: 1.6 }, true)
    const bb = new THREE.Box3().setFromObject(j)
    j.position.z = 1.62 - bb.max.z
    group.add(j)
    const tag = box(0.3, 0.08, 0.02, mat(color), 0, 0.5, 0.05, group, false)
    tag.visible = true
    const slot = new THREE.Group(); slot.position.set(0, 0.03, 1.0); group.add(slot)
    return { group, slot }
  }
}

function labelSprite(i: number): THREE.Sprite {
  const tex = canvasTex(160, 80, (g, w, h) => {
    g.fillStyle = PLAYER_COLORS[i]
    g.beginPath(); g.moveTo(30, 6); g.arcTo(w - 6, 6, w - 6, h - 16, 22); g.arcTo(w - 6, h - 16, 6, h - 16, 22)
    g.lineTo(w / 2 + 10, h - 16); g.lineTo(w / 2, h - 2); g.lineTo(w / 2 - 10, h - 16); g.arcTo(6, h - 16, 6, 6, 22); g.arcTo(6, 6, w - 6, 6, 22); g.fill()
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke()
    g.fillStyle = '#fff'; g.font = `800 44px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P' + (i + 1), w / 2, (h - 14) / 2 + 3)
  })
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }))
  s.scale.set(1.1, 0.55, 1)
  s.renderOrder = 10
  return s
}

function makeArrow(color: string): THREE.Group {
  const g = new THREE.Group()
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.35 })
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.6, 24), m); cone.rotation.x = Math.PI; g.add(cone)
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 16), m); sh.position.y = 0.55; g.add(sh)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffffff })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; g.add(ring)
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true })
  return g
}

/** Forklift body length (without forks) and driver hip placement; tuned against the generated model. */
export const FORK_LEN = 2.15
export const WALK_SCALE = 1.3
export const SEAT = { y: 0.2, z: -0.55 }

const CARTON_OFFS = [[-0.275, -0.25], [0.275, -0.25], [-0.275, 0.25], [0.275, 0.25]] as const

/** All visuals for one lane's player. */
export class Actor {
  readonly root = new THREE.Group()
  readonly worker: Worker
  readonly fork: ReturnType<Kit['forklift']>
  readonly jack: ReturnType<Kit['palletJack']>
  readonly label: THREE.Sprite
  readonly hiSlot: THREE.Mesh
  readonly hiRing: THREE.Mesh
  readonly hiCell: THREE.Mesh
  readonly arrow: THREE.Group
  private mode = ''

  constructor(readonly id: number, kit: Kit, parent: THREE.Object3D) {
    const color = PLAYER_COLORS[id]
    this.worker = new Worker(kit.models, kit.cartonSrc)
    this.fork = kit.forklift(color)
    this.jack = kit.palletJack(color)
    this.root.add(this.fork.group, this.jack.group, this.worker.root)
    this.label = labelSprite(id)
    this.label.position.y = 2.6
    this.root.add(this.label)
    // player colour disc under the feet/vehicle so lanes stay readable from the high camera
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }))
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02; disc.name = 'disc'
    this.root.add(disc)
    parent.add(this.root)
    const hc = new THREE.Color(color)
    this.hiSlot = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.3), new THREE.MeshBasicMaterial({ color: hc, transparent: true, opacity: 0.5, depthWrite: false }))
    this.hiSlot.rotation.x = -Math.PI / 2
    this.hiRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.1, 48), new THREE.MeshBasicMaterial({ color: hc, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }))
    this.hiRing.rotation.x = -Math.PI / 2
    this.hiCell = new THREE.Mesh(new THREE.BoxGeometry(1.16, 1.18, 1.22), new THREE.MeshBasicMaterial({ color: hc, transparent: true, opacity: 0.3, depthWrite: false }))
    this.arrow = makeArrow(color)
    parent.add(this.hiSlot, this.hiRing, this.hiCell, this.arrow)
  }

  dispose(): void {
    for (const o of [this.root, this.hiSlot, this.hiRing, this.hiCell, this.arrow]) o.removeFromParent()
  }

  update(p: Player, dt: number, t: number, target: Target | null, alpha = 1): void {
    const sx = p.shake > 0 ? Math.sin(t * 38) * 0.05 * (p.shake / 0.3) : 0
    const bp = blendPose(p, alpha)
    this.root.position.set(laneX(p.id) + bp.x + sx, 0, bp.z)
    this.root.rotation.y = bp.ang
    const speed = Math.hypot(p.vx, p.vz)
    if (this.mode !== p.mode) {
      this.mode = p.mode
      this.fork.group.visible = p.mode === 'fork'
      this.jack.group.visible = p.mode === 'jack'
      const w = this.worker.root
      if (p.mode === 'fork') { this.fork.seat.add(w); w.position.set(0, 0, 0) }
      else { this.root.add(w); w.position.set(0, 0, p.mode === 'jack' ? -0.5 : 0) }
      // On foot the worker is drawn a little larger so kids can spot him from the overview camera.
      w.scale.setScalar(p.mode === 'walk' ? WALK_SCALE : 1)
      ;(this.root.getObjectByName('disc') as THREE.Mesh).scale.setScalar(p.mode === 'walk' ? 1 : 1.75)
    }
    this.worker.carton.visible = p.carry === 'box'
    const pose = p.mode === 'fork' ? 'drive' : p.mode === 'jack' ? 'push' : p.carry === 'box' ? 'carry' : 'free'
    this.worker.update(dt, speed, pose)
    if (p.mode === 'fork') this.fork.car.position.y = p.forkY
    this.label.position.y = p.mode === 'fork' ? 2.75 : 2.45

    // target highlight
    const pulse = 0.5 + 0.5 * Math.sin(t * 6)
    this.hiSlot.visible = this.hiRing.visible = this.hiCell.visible = this.arrow.visible = false
    if (!target) return
    const lx = laneX(p.id)
    let ax = 0, ay = 0, az = 0
    if (target.k === 'slot') {
      const s = slotPos(target.zone, target.i)
      this.hiSlot.visible = true
      this.hiSlot.position.set(lx + s.x, 0.025, s.z)
      ;(this.hiSlot.material as THREE.MeshBasicMaterial).opacity = (target.pick ? 0.25 : 0.35) + 0.4 * pulse
      ax = lx + s.x; ay = target.pick ? 1.6 : 1.2; az = s.z
    } else if (target.k === 'pt') {
      this.hiRing.visible = true
      this.hiRing.position.set(lx + target.x, 0.03, target.z)
      const sc = 1 + 0.15 * pulse
      this.hiRing.scale.set(sc, sc, 1)
      ax = lx + target.x; ay = 1.8; az = target.z
    } else {
      const c = target.c, up = c >= 5
      this.hiCell.visible = true
      this.hiCell.position.set(lx + bayX(c % 5), LVY[up ? 1 : 0] + 0.6, RACK_Z)
      ;(this.hiCell.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.3 * pulse
      ax = lx + bayX(c % 5); ay = 3.2; az = (RK.z0 + RK.z1) / 2
    }
    this.arrow.visible = true
    this.arrow.position.set(ax, ay + 0.25 * Math.sin(t * 5), az)
    this.arrow.rotation.y = t * 2
  }

  /** World matrix where a pallet sits when carried in the current mode. */
  carrySlot(): THREE.Object3D { return this.mode === 'fork' ? this.fork.slot : this.jack.slot }
}

/** Instanced pallets + cartons for every player (one draw call each). */
export class Cargo {
  readonly pallets: THREE.InstancedMesh
  readonly cartons: THREE.InstancedMesh
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3(1, 1, 1)
  private off = new THREE.Matrix4()
  private carton = new THREE.Matrix4()

  constructor(kit: Kit, parent: THREE.Object3D) {
    this.pallets = new THREE.InstancedMesh(kit.palletParts.geometry, kit.palletParts.material, 40)
    this.cartons = new THREE.InstancedMesh(kit.cartonParts.geometry, kit.cartonParts.material, 160)
    for (const im of [this.pallets, this.cartons]) {
      im.castShadow = im.receiveShadow = true
      im.frustumCulled = false
      im.count = 0
      parent.add(im)
    }
    const c = new THREE.Color()
    for (let i = 0; i < 160; i++) this.cartons.setColorAt(i, c.setHSL(0.08, 0.25, 0.86 + ((i * 37) % 11) / 80))
  }

  update(players: Player[], actors: (Actor | undefined)[], t: number): void {
    let np = 0, nc = 0
    for (const p of players) {
      const a = actors[p.id]
      if (!p.active || !a) continue
      for (const loc of p.pallets) {
        if (loc.at === 'none') continue
        if (loc.at === 'floor') {
          this.m.compose(this.v.set(laneX(p.id) + loc.x, loc.y, loc.z), this.q.identity(), this.s)
        } else {
          const slot = a.carrySlot()
          slot.updateWorldMatrix(true, false)
          this.m.copy(slot.matrixWorld)
          if (p.shake > 0) this.m.multiply(this.off.makeRotationZ(Math.sin(t * 38) * 0.035))
        }
        this.pallets.setMatrixAt(np++, this.m)
        for (let k = 0; k < loc.boxes; k++) {
          this.carton.makeTranslation(CARTON_OFFS[k][0], 0.16, CARTON_OFFS[k][1])
          this.cartons.setMatrixAt(nc++, this.off.multiplyMatrices(this.m, this.carton))
        }
      }
    }
    this.pallets.count = np
    this.cartons.count = nc
    this.pallets.instanceMatrix.needsUpdate = true
    this.cartons.instanceMatrix.needsUpdate = true
  }
}

/** Crisp company logo texture: white "DKSH" on transparent background (optionally on a red patch). */
let logoTex: THREE.CanvasTexture | undefined
function brandTexture(): THREE.CanvasTexture {
  if (logoTex) return logoTex
  const c = document.createElement('canvas')
  c.width = 512; c.height = 192
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.font = '900 150px "Arial Black", "Helvetica Neue", Arial, sans-serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText('DKSH', c.width / 2, c.height / 2 + 6, c.width - 24)
  logoTex = new THREE.CanvasTexture(c)
  logoTex.colorSpace = THREE.SRGBColorSpace
  logoTex.anisotropy = 8
  return logoTex
}
/**
 * The generated model's printed logos are too soft to read at play distance, so sharp logo decals are
 * projected onto the cap, chest and back in the bind pose and attached to the matching bones.
 */
function addBrandDecals(root: THREE.Object3D, src: THREE.Object3D, bones: Record<string, THREE.Object3D>): void {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(src)
  const top = box.max.y
  const meshes: THREE.Object3D[] = []
  src.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o) })
  const ray = new THREE.Raycaster()
  const mat = new THREE.MeshStandardMaterial({ map: brandTexture(), transparent: true, roughness: 0.65, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
  const place = (y: number, dir: 1 | -1, width: number, bone: string, x = 0) => {
    ray.set(new THREE.Vector3(x, y, dir * 2), new THREE.Vector3(0, 0, -dir))
    const hit = ray.intersectObjects(meshes, false)[0]
    const b = bones[bone]
    if (!hit || !b) return
    const n = new THREE.Vector3(0, 0, dir)
    if (hit.face) { const fn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); if (fn.dot(n) > 0.4) n.copy(fn) }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 192 / 512), mat)
    m.position.copy(hit.point).addScaledVector(n, 0.008)
    m.lookAt(m.position.clone().add(n))
    m.renderOrder = 2
    root.add(m)
    b.attach(m)
  }
  place(top - 0.065, 1, 0.13, 'Head') // cap front
  place(top * 0.745, 1, 0.2, 'Spine02') // chest
  place(top * 0.725, -1, 0.4, 'Spine02') // back print
  // Top of the cap: the play camera looks down, so this is the logo players see most.
  ray.set(new THREE.Vector3(0, top + 1, 0.02), new THREE.Vector3(0, -1, 0))
  const hit = ray.intersectObjects(meshes, false)[0]
  if (hit && bones.Head) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17 * 192 / 512), mat)
    m.position.copy(hit.point).add(new THREE.Vector3(0, 0.01, 0))
    m.rotation.x = -Math.PI / 2 // faces up, lettering reads from the front of the worker
    m.renderOrder = 2
    root.add(m)
    bones.Head.attach(m)
  }
}
