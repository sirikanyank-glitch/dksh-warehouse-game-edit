import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Renderer } from '../engine/renderer'
import { Actor, Cargo, Kit, blendPose } from './actors'
import { CONFIG } from './config'
import type { Controls } from './controls'
import { PLAYER_COLORS, laneX } from './layout'
import type { Models } from './models'
import { Sim, type Settings, type SimEvent } from './sim'
import { World } from './world'

/** Short, light-hearted worker lines. Kept out of the HUD so instructions stay clear. */
export const QUIPS = {
  pickBox: ['ฮึบ! หนักใช้ได้', 'ยกถูกท่า หลังไม่พัง', 'กล่องนี้หนักเท่าความรับผิดชอบ', 'หลังยังไหวครับ', 'อีกกล่อง สู้!'],
  jack: ['รถลากมา ชีวิตง่ายขึ้น', 'ลากสบาย ๆ แต่รีบนะ'],
  fork: ['ใบขับขี่พร้อม!', 'คาดเข็มขัดก่อนนะ'],
  rack: ['เข้าที่พอดีเป๊ะ', 'เป๊ะยิ่งกว่าไม้บรรทัด', 'จัดเรียงสวยงาม'],
  order: ['ใบสั่งมาแล้ว ลุย!', 'ลูกค้ารออยู่ครับ'],
  load: ['ปิดตู้ ส่งของ!', 'อีกนิดเดียว!'],
  bump: ['ขอโทษครับแร็ค…', 'หัวหน้าไม่เห็นนะ', 'เบรกไม่ทัน!'],
  finish: ['เลิกงานตรงเวลา!', 'ข้าวมันไก่รออยู่!', 'ไม่ต้องทำโอที!'],
  idle: ['พักแป๊บ… กาแฟเย็นหมดแล้ว', 'หัวหน้าไม่ได้มองใช่ไหม', 'งานไม่เดินเองนะ'],
  chatter: ['สู้ ๆ คนคลัง!', 'ระวังทางแยกนะครับ', 'บี๊บ ๆ คือเพลงประจำกะ', 'ส่งตรงเวลา ลูกค้ายิ้ม'],
} as const
type QuipKind = keyof typeof QUIPS
const pickRandom = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]

type Floating = { el: HTMLElement; v: THREE.Vector3; life: number; rise: number; follow?: number }

export class Game {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 1, 300)
  readonly world: World
  readonly sim: Sim
  private kit: Kit
  private dyn = new THREE.Group()
  private actors: (Actor | undefined)[] = []
  private cargo: Cargo
  private floats: Floating[] = []
  private bubbles: (Floating | undefined)[] = []
  private quipCd = [0, 0, 0, 0]
  private chatterT = [0, 0, 0, 0]
  private idleT = [0, 0, 0, 0]
  private confetti: { m: THREE.Mesh; vx: number; vy: number; vz: number; r: number; life: number }[] = []
  private time = 0
  private camTarget = new THREE.Vector3(0, 0, 1.2)
  /** Follow mode: each active lane gets its own screen column and a close camera that tracks its worker. */
  follow = true
  private laneCams = [0, 1, 2, 3].map(() => new THREE.PerspectiveCamera(30, 1, 0.5, 220))
  private laneFocus = [0, 1, 2, 3].map(() => new THREE.Vector2(0, -9))
  private laneView = { vw: 0, h: 0, on: false }
  private camDir = new THREE.Vector3(0, 0.74, 0.67).normalize()
  private lastFov = 0
  onEnd?: () => void

  constructor(private renderer: Renderer, models: Models, private controls: Controls, private audio: Audio, private fxLayer: HTMLElement, settings: Settings) {
    this.world = new World(this.scene, renderer.gl, models, renderer.shadowMapSize)
    this.kit = new Kit(models)
    this.scene.add(this.dyn)
    this.cargo = new Cargo(this.kit, this.scene)
    this.sim = new Sim(settings)
    this.world.paintFloor(settings.pallets)
    this.rebuild()
  }

  /** Recreate per-player visuals after settings change or a new round. */
  rebuild(): void {
    for (const a of this.actors) a?.dispose()
    this.actors = this.sim.players.map(p => (p.active ? new Actor(p.id, this.kit, this.dyn) : undefined))
    this.clearFx()
    this.quipCd = [3, 3, 3, 3]
    this.chatterT = [12, 15, 18, 21]
    this.idleT = [0, 0, 0, 0]
  }

  applySettings(s: Settings): void {
    const palletsChanged = s.pallets !== this.sim.settings.pallets
    this.sim.settings = s
    this.sim.state = 'menu'
    this.sim.reset()
    if (palletsChanged) this.world.paintFloor(s.pallets)
    this.rebuild()
    this.lastFov = 0
  }

  start(): void {
    this.sim.start()
    this.rebuild()
  }

  step(dt: number): void {
    this.sim.step(dt, this.controls.read())
    for (const e of this.sim.events.splice(0)) this.handle(e)
  }

  private handle(e: SimEvent): void {
    switch (e.type) {
      case 'tick': case 'go': this.audio.play(e.type); return
      case 'end': this.audio.play('end'); this.onEnd?.(); return
      case 'pickBox': this.audio.play('pick'); this.quip(e.p, 'pickBox', 0.35); return
      case 'pick': this.audio.play('pick'); return
      case 'place': {
        this.audio.play('place')
        const p = this.sim.players[e.p]
        if (p.stage === 3 && p.carry === null && p.stored > 0) this.quip(e.p, 'rack', 0.3)
        if (p.stage === 5 && p.loaded > 0) this.quip(e.p, 'load', 0.3)
        return
      }
      case 'stage': {
        this.audio.play('stage')
        const p = this.sim.players[e.p]
        const kind: QuipKind | undefined = p.stage === 2 ? 'jack' : p.stage === 3 ? 'fork' : p.stage === 4 ? 'order' : undefined
        if (kind) window.setTimeout(() => this.quip(e.p, kind, 0.8, true), 1300)
        return
      }
      case 'bump': this.audio.play('bump'); window.setTimeout(() => this.quip(e.p, 'bump', 0.6, true), 900); return
      case 'finish': {
        this.audio.play('win')
        this.burst(laneX(e.p), 12)
        window.setTimeout(() => this.quip(e.p, 'finish', 1, true), 1200)
        return
      }
      case 'say': {
        const p = this.sim.players[e.p]
        const lx = laneX(e.p)
        const pos = e.x !== undefined ? new THREE.Vector3(lx + e.x, e.y ?? 2.6, e.z ?? 0) : new THREE.Vector3(lx + p.x, 2.9, p.z)
        this.floatText(pos, e.text, e.color ?? PLAYER_COLORS[e.p], !!e.big)
      }
    }
  }

  private floatText(v: THREE.Vector3, text: string, color: string, big: boolean): void {
    const el = document.createElement('div')
    el.className = 'fx' + (big ? ' big' : '')
    el.textContent = text
    el.style.color = color
    this.fxLayer.appendChild(el)
    this.floats.push({ el, v, life: 1.3, rise: 0.9 })
  }

  /** Speech bubble above a worker; rate-limited so it never crowds the guidance. */
  private quip(id: number, kind: QuipKind, chance: number, force = false): void {
    const p = this.sim.players[id]
    if (!p?.active || this.sim.state === 'menu') return
    if (!force && (this.quipCd[id] > 0 || Math.random() > chance)) return
    if (force && this.quipCd[id] > 2.5) return
    this.quipCd[id] = 5
    this.bubbles[id]?.el.remove()
    const el = document.createElement('div')
    el.className = 'bubble'
    el.style.setProperty('--pc', PLAYER_COLORS[id])
    el.textContent = pickRandom(QUIPS[kind])
    this.fxLayer.appendChild(el)
    this.bubbles[id] = { el, v: new THREE.Vector3(), life: 2.4, rise: 0, follow: id }
  }

  private clearFx(): void {
    for (const f of this.floats) f.el.remove()
    for (const b of this.bubbles) b?.el.remove()
    this.floats = []
    this.bubbles = []
    for (const c of this.confetti) c.m.removeFromParent()
    this.confetti = []
  }

  private burst(x: number, z: number): void {
    const cs = [...PLAYER_COLORS, '#ffd21f', '#ffffff']
    const geo = new THREE.BoxGeometry(0.16, 0.03, 0.1)
    for (let k = 0; k < 70; k++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cs[k % 6] }))
      m.position.set(x, 1.5, z)
      this.scene.add(m)
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 4
      this.confetti.push({ m, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 5 + Math.random() * 5, r: Math.random() * 8, life: 2.4 })
    }
  }

  fitCamera(): void {
    const cam = this.camera
    const pts: THREE.Vector3[] = []
    const n = this.sim.settings.players
    const x0 = laneX(0) - 4.9, x1 = laneX(n - 1) + 4.9
    this.camTarget.set((x0 + x1) / 2, 0, 0.6)
    for (const x of [x0, x1]) for (const z of [-13.6, 14.2]) for (const y of [0, 1.5]) pts.push(new THREE.Vector3(x, y, z))
    let d = 70
    for (let it = 0; it < 6; it++) {
      cam.position.copy(this.camTarget).addScaledVector(this.camDir, d)
      cam.lookAt(this.camTarget)
      cam.updateMatrixWorld()
      cam.updateProjectionMatrix()
      let mx = 0
      for (const p of pts) { const v = p.clone().project(cam); mx = Math.max(mx, Math.abs(v.x), Math.abs(v.y)) }
      d *= mx / 1.0
    }
    cam.position.copy(this.camTarget).addScaledVector(this.camDir, d)
    cam.lookAt(this.camTarget)
    if (this.scene.fog instanceof THREE.Fog) { this.scene.fog.near = d * 1.1; this.scene.fog.far = d * 2.6 }
  }

  private alpha = 1
  render(frame: number, alpha = 1): void {
    this.alpha = alpha
    const dt = Math.min(frame, 0.05)
    this.time += dt
    const t = this.time
    const canvas = this.renderer.canvas
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (w && h && (Math.abs(this.camera.aspect - w / h) > 1e-3 || this.lastFov !== CONFIG.camera.fov)) {
      this.camera.aspect = w / h
      this.camera.fov = this.lastFov = CONFIG.camera.fov
      this.camera.updateProjectionMatrix()
      this.fitCamera()
    }
    const sim = this.sim
    const showTargets = sim.state === 'play' || sim.state === 'count' || sim.state === 'pause'
    const animDt = sim.state === 'pause' ? 0 : dt
    for (const p of sim.players) {
      const a = this.actors[p.id]
      if (!p.active || !a) continue
      a.update(p, animDt, t, showTargets && !p.finished ? sim.target(p) : null, sim.state === 'pause' ? 1 : alpha)
      if (sim.state === 'play' && !p.finished) {
        this.quipCd[p.id] -= dt
        const moving = Math.hypot(p.vx, p.vz) > 0.3
        this.idleT[p.id] = moving ? 0 : this.idleT[p.id] + dt
        if (this.idleT[p.id] > 8) { this.idleT[p.id] = -6; this.quip(p.id, 'idle', 1) }
        this.chatterT[p.id] -= dt
        if (this.chatterT[p.id] <= 0) { this.chatterT[p.id] = 16 + Math.random() * 10; this.quip(p.id, 'chatter', 0.6) }
      }
    }
    this.cargo.update(sim.players, this.actors, t)
    this.world.animate(t)
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i]
      c.life -= animDt
      c.vy -= 12 * animDt
      c.m.position.x += c.vx * animDt
      c.m.position.y = Math.max(0.02, c.m.position.y + c.vy * animDt)
      c.m.position.z += c.vz * animDt
      c.m.rotation.x += c.r * animDt
      c.m.rotation.y += c.r * animDt * 0.7
      if (c.m.position.y <= 0.02) { c.vx *= 0.9; c.vz *= 0.9 }
      if (c.life <= 0) { c.m.removeFromParent(); (c.m.material as THREE.Material).dispose(); this.confetti.splice(i, 1) }
    }
    const lanes = this.follow && (sim.state === 'play' || sim.state === 'count' || sim.state === 'pause')
    if (lanes) this.renderLanes(dt, w, h)
    else { this.laneView.on = false; this.renderer.render(this.scene, this.camera) }
    this.renderFx(dt, w, h)
  }

  /** Window of floor (metres) each follow camera keeps in view around its worker. */
  static readonly VIEW_W = 7.2
  static readonly VIEW_D = 11.5
  private renderLanes(dt: number, w: number, h: number): void {
    const n = this.sim.settings.players, gl = this.renderer.gl
    const gap = n > 1 ? 4 : 0
    const vw = (w - gap * (n - 1)) / n
    this.laneView = { vw: vw + gap, h, on: true }
    const vfov = THREE.MathUtils.degToRad(CONFIG.camera.fov)
    const elev = Math.asin(this.camDir.y)
    gl.setScissorTest(false)
    gl.setClearColor('#10303a', 1)
    gl.clear()
    gl.setScissorTest(true)
    for (let i = 0; i < n; i++) {
      const p = this.sim.players[i], cam = this.laneCams[i], f = this.laneFocus[i]
      // Focus slightly ahead of the worker (towards the camera) and keep the window inside the lane.
      const halfW = Math.min(5.2, Game.VIEW_W / 2)
      const bp = blendPose(p, this.alpha)
      const tx = THREE.MathUtils.clamp(bp.x, -5.2 + halfW, 5.2 - halfW)
      const tz = THREE.MathUtils.clamp(bp.z + 1.2, -10.2, 9.6)
      const k = 1 - Math.exp(-dt * 6)
      f.x += (tx - f.x) * k; f.y += (tz - f.y) * k
      cam.fov = CONFIG.camera.fov
      cam.aspect = vw / h
      cam.updateProjectionMatrix()
      const hfovTan = Math.tan(vfov / 2) * cam.aspect
      const dW = (Game.VIEW_W / 2) / hfovTan
      const dD = (Game.VIEW_D * Math.sin(elev)) / (2 * Math.tan(vfov / 2))
      const d = Math.max(dW, dD)
      const target = new THREE.Vector3(laneX(i) + f.x, 0.6, f.y)
      cam.position.copy(target).addScaledVector(this.camDir, d)
      cam.lookAt(target)
      cam.updateMatrixWorld()
      const x = i * (vw + gap)
      gl.setViewport(x, 0, vw, h)
      gl.setScissor(x, 0, vw, h)
      gl.render(this.scene, cam)
    }
    gl.setScissorTest(false)
    gl.setViewport(0, 0, w, h)
    if (this.scene.fog instanceof THREE.Fog) { this.scene.fog.near = 60; this.scene.fog.far = 200 }
  }
  private renderFx(dt: number, w: number, h: number): void {
    const tmp = new THREE.Vector3()
    const place = (f: Floating) => {
      if (this.laneView.on) {
        const n = this.sim.settings.players
        const lane = Math.max(0, Math.min(n - 1, Math.round((f.v.x - laneX(0)) / (laneX(1) - laneX(0)))))
        tmp.copy(f.v).project(this.laneCams[lane])
        const vw = this.laneView.vw - (n > 1 ? 4 : 0)
        const px = lane * this.laneView.vw + ((tmp.x + 1) / 2) * vw
        f.el.style.transform = `translate(${px}px, ${((1 - tmp.y) / 2) * h}px)`
        f.el.style.visibility = Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05 ? 'hidden' : ''
        return
      }
      f.el.style.visibility = ''
      tmp.copy(f.v).project(this.camera)
      f.el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]
      f.life -= dt
      f.v.y += dt * f.rise
      place(f)
      f.el.style.opacity = String(Math.max(0, Math.min(1, f.life * 1.6)))
      if (f.life <= 0) { f.el.remove(); this.floats.splice(i, 1) }
    }
    this.bubbles.forEach((b, id) => {
      if (!b) return
      const p = this.sim.players[id]
      b.life -= dt
      { const bp = blendPose(p, this.alpha); b.v.set(laneX(id) + bp.x, p.mode === 'fork' ? 3.25 : 2.95, bp.z) }
      place(b)
      b.el.style.opacity = String(Math.max(0, Math.min(1, b.life * 3)))
      if (b.life <= 0) { b.el.remove(); this.bubbles[id] = undefined }
    })
  }
}
