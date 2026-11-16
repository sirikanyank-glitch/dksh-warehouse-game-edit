import { CONFIG } from './config'
import {
  BOX_PER, FORK_CARRY, FORK_REST, LANE_HX, LVY, PEN_BUMP, PSPOT, RACK_Z, RK, TRUCK_Z,
  bayX, cellName, clamp, dist, slotPos,
} from './layout'

export type Mode = 'walk' | 'jack' | 'fork'
export type SimState = 'menu' | 'count' | 'play' | 'pause' | 'over'
export type Settings = { players: number; pallets: number; minutes: number }
export type PlayerInput = { x: number; y: number; a: boolean }

/** Where a pallet currently is; the render layer reads this to place meshes. */
export type PalletLoc =
  | { at: 'none' }
  | { at: 'floor'; x: number; y: number; z: number; boxes: number }
  | { at: 'jack' | 'fork'; boxes: number }

export type Target =
  | { k: 'pt'; x: number; z: number }
  | { k: 'slot'; zone: 2 | 4; i: number; pick?: boolean }
  | { k: 'cell'; c: number }

export type SimEvent =
  | { type: 'pickBox' | 'pick' | 'place' | 'bump' | 'stage' | 'finish'; p: number }
  | { type: 'say'; p: number; text: string; color?: string; big?: boolean; x?: number; y?: number; z?: number }
  | { type: 'tick' | 'go' | 'end' }

export interface Player {
  id: number
  active: boolean
  x: number; z: number; vx: number; vz: number; ang: number
  /** Pose at the start of the last fixed step; the renderer blends from here to x/z/ang. */
  px: number; pz: number; pang: number
  mode: Mode
  /** 'box' while carrying a carton by hand, a pallet index while carrying a pallet, or null. */
  carry: null | 'box' | number
  stage: number
  boxes: number; built: number; stored: number; picked: number; loaded: number
  s2: number[]; rack: number[]; s4: number[]
  /** Random rack cells to store into, and the random pick order for the outbound orders. */
  rt: number[]; orders: number[]
  forkY: number
  penalty: number; bumps: number
  finished: boolean; finishTime: number; place: number
  stun: number; bumpCd: number; shake: number; hintCd: number
  aHeld: boolean
  pallets: PalletLoc[]
  /** Accumulated travel used for the walk cycle / wheel spin. */
  travel: number
}

export function shuffle<T>(a: T[], rng: () => number = Math.random): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function createPlayer(id: number, settings: Settings, rng: () => number = Math.random): Player {
  const N = settings.pallets
  const rt = shuffle([...Array(10).keys()], rng).slice(0, N)
  const p: Player = {
    id, active: id < settings.players, x: 0, z: -10.8, vx: 0, vz: 0, ang: Math.PI, px: 0, pz: -10.8, pang: Math.PI, mode: 'walk', carry: null,
    stage: 1, boxes: 0, built: 0, stored: 0, picked: 0, loaded: 0,
    s2: Array(10).fill(-1), rack: Array(10).fill(-1), s4: Array(10).fill(-1), rt, orders: shuffle(rt.slice(), rng),
    forkY: FORK_REST, penalty: 0, bumps: 0, finished: false, finishTime: 0, place: 0,
    stun: 0, bumpCd: 0, shake: 0, hintCd: 0, aHeld: false, travel: 0,
    pallets: Array.from({ length: N }, () => ({ at: 'none' }) as PalletLoc),
  }
  if (p.active) p.pallets[0] = { at: 'floor', x: PSPOT.x, y: 0, z: PSPOT.z, boxes: 0 }
  return p
}

export const progressOf = (p: Player, N: number): number =>
  p.finished ? N : [p.built, p.built, p.stored, p.picked, p.loaded][p.stage - 1]
export const scoreOf = (p: Player): number => p.built + p.stored + p.picked + p.loaded

/** Final ranking: finishers by time+penalty, then by progress, then fewer penalties. */
export function rank(players: Player[]): Player[] {
  return players.filter(p => p.active).sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime + a.penalty - (b.finishTime + b.penalty)
    if (a.finished !== b.finished) return a.finished ? -1 : 1
    return scoreOf(b) - scoreOf(a) || a.penalty - b.penalty
  })
}
export const starsOf = (p: Player): number => (p.finished ? (p.penalty === 0 ? 3 : 2) : scoreOf(p) > 0 ? 1 : 0)

export function hudHint(p: Player): string {
  if (!p.active) return 'ไม่มีผู้เล่น'
  if (p.finished) return 'โหลดครบแล้ว เก่งมาก!'
  switch (p.stage) {
    case 1: return p.carry === 'box' ? `เอากล่องไปวางบนพาเลท (${p.boxes}/${BOX_PER})` : 'เดินไปหยิบกล่องที่ท้ายรถ'
    case 2: return 'ลากพาเลทไปช่องที่กระพริบ'
    case 3: return p.carry !== null ? 'เก็บเข้าแร็ค ' + cellName(p.rt[p.stored]) : 'ขับไปตักพาเลทที่จุด 2'
    case 4: return p.carry !== null ? 'วางที่ช่องพักขาออกที่กระพริบ' : 'ใบสั่ง: หยิบ ' + cellName(p.orders[p.picked])
    case 5: return p.carry !== null ? 'ขับเข้าตู้คอนเทนเนอร์' : 'ขับไปตักพาเลทที่จุด 4'
  }
  return ''
}

export class Sim {
  players: Player[] = []
  state: SimState = 'menu'
  timeLeft = 0
  elapsed = 0
  countT = 0
  private lastCount = 0
  private finishOrder = 0
  private endTimer = -1
  events: SimEvent[] = []

  constructor(public settings: Settings, private rng: () => number = Math.random) {
    this.reset()
  }

  reset(): void {
    this.players = [0, 1, 2, 3].map(i => createPlayer(i, this.settings, this.rng))
    this.timeLeft = this.settings.minutes * 60
    this.elapsed = 0
    this.finishOrder = 0
    this.endTimer = -1
    this.events = []
  }

  start(): void {
    this.reset()
    this.state = 'count'
    this.countT = 4
    this.lastCount = 0
  }

  togglePause(): void {
    if (this.state === 'play' || this.state === 'count') this.state = 'pause'
    else if (this.state === 'pause') this.resume()
  }
  resume(): void {
    if (this.state === 'pause') this.state = this.countT > 1 ? 'count' : 'play'
  }

  private emit(e: SimEvent): void { this.events.push(e) }
  private say(p: Player, text: string, color?: string, big?: boolean, at?: { x: number; y: number; z: number }): void {
    this.emit({ type: 'say', p: p.id, text, color, big, ...at })
  }
  private hint(p: Player, text: string): void {
    if (p.hintCd > 0) return
    p.hintCd = 1
    this.say(p, text, '#fff')
  }

  target(p: Player): Target | null {
    const N = this.settings.pallets
    const nearest = (zone: 2 | 4, arr: number[]): Target | null => {
      let b = -1, bd = 1e9
      for (let i = 0; i < N; i++) {
        if (arr[i] < 0) continue
        const s = slotPos(zone, i), d = dist(p.x, p.z, s.x, s.z)
        if (d < bd) { bd = d; b = i }
      }
      return b < 0 ? null : { k: 'slot', zone, i: b, pick: true }
    }
    switch (p.stage) {
      case 1: return p.carry === 'box' ? { k: 'pt', x: PSPOT.x, z: PSPOT.z } : { k: 'pt', x: 0, z: -12.1 }
      case 2: return { k: 'slot', zone: 2, i: p.built }
      case 3: return p.carry === null ? nearest(2, p.s2) : { k: 'cell', c: p.rt[p.stored] }
      case 4: return p.carry === null ? { k: 'cell', c: p.orders[p.picked] } : { k: 'slot', zone: 4, i: p.picked }
      case 5: return p.carry === null ? nearest(4, p.s4) : { k: 'pt', x: 0, z: 12.2 }
    }
    return null
  }

  /** Pallet carried on the vehicle keeps its box count. */
  private boxesOf(p: Player, idx: number): number {
    const l = p.pallets[idx]
    return l.at === 'none' ? 0 : l.boxes
  }
  private put(p: Player, idx: number, loc: { x: number; y?: number; z: number } | 'jack' | 'fork'): void {
    const boxes = this.boxesOf(p, idx)
    p.pallets[idx] = typeof loc === 'string' ? { at: loc, boxes } : { at: 'floor', x: loc.x, y: loc.y ?? 0, z: loc.z, boxes }
  }

  interact(p: Player, manual: boolean): void {
    const N = this.settings.pallets, k = manual ? 1.5 : 1
    const fd = p.mode === 'walk' ? 0.45 : p.mode === 'jack' ? 1.0 : 1.35
    const fx = p.x + Math.sin(p.ang) * fd, fz = p.z + Math.cos(p.ang) * fd
    if (p.stage === 1) {
      if (p.carry === null && p.boxes < BOX_PER) {
        if (p.z < TRUCK_Z + (manual ? 0.9 : 0.1) && Math.abs(p.x) < 1.8) { p.carry = 'box'; this.emit({ type: 'pickBox', p: p.id }); return }
        if (manual) this.hint(p, 'ไปหยิบกล่องที่ท้ายรถ')
        return
      }
      if (p.carry === 'box') {
        if (dist(p.x, p.z, PSPOT.x, PSPOT.z) < 1.0 * k) {
          p.carry = null
          p.boxes++
          p.pallets[p.built] = { at: 'floor', x: PSPOT.x, y: 0, z: PSPOT.z, boxes: p.boxes }
          this.emit({ type: 'place', p: p.id })
          this.say(p, p.boxes + '/' + BOX_PER, undefined, true, { x: PSPOT.x, y: 1.6, z: PSPOT.z })
          if (p.boxes >= BOX_PER) {
            p.mode = 'jack'; p.stage = 2; p.vx = p.vz = 0
            p.carry = p.built
            this.put(p, p.built, 'jack')
            this.emit({ type: 'stage', p: p.id })
            this.say(p, 'ได้รถลากพาเลท!', undefined, true)
          }
          return
        }
        if (manual) this.hint(p, 'เอากล่องไปวางบนพาเลท')
      }
      return
    }
    if (p.stage === 2) {
      const s = slotPos(2, p.built)
      if (dist(fx, fz, s.x, s.z) < 0.8 * k && typeof p.carry === 'number') {
        const idx = p.carry
        this.put(p, idx, { x: s.x, z: s.z })
        p.s2[p.built] = idx; p.built++; p.carry = null
        this.emit({ type: 'place', p: p.id })
        this.say(p, '+1', undefined, true, { x: s.x, y: 1.4, z: s.z })
        if (p.built >= N) {
          p.mode = 'fork'; p.stage = 3
          this.emit({ type: 'stage', p: p.id })
          this.say(p, 'ได้โฟล์คลิฟต์แล้ว!', undefined, true)
        } else {
          p.mode = 'walk'; p.stage = 1; p.boxes = 0
          p.pallets[p.built] = { at: 'floor', x: PSPOT.x, y: 0, z: PSPOT.z, boxes: 0 }
        }
        return
      }
      if (manual) this.hint(p, 'ไปที่ช่องที่กระพริบ')
      return
    }
    const inBay = (c: number) => Math.abs(fx - bayX(c % 5)) < 0.5 * k && fz < RK.z1 + 0.3 && Math.abs(p.forkY - LVY[c >= 5 ? 1 : 0]) < 0.14
    if (p.stage === 3) {
      if (p.carry === null) {
        for (let i = 0; i < N; i++) {
          if (p.s2[i] < 0) continue
          const s = slotPos(2, i)
          if (dist(fx, fz, s.x, s.z) < 0.8 * k) { p.carry = p.s2[i]; p.s2[i] = -1; this.put(p, p.carry, 'fork'); this.emit({ type: 'pick', p: p.id }); return }
        }
        if (manual) this.hint(p, 'ขับไปตักพาเลทที่จุด 2')
        return
      }
      const t = p.rt[p.stored]
      if (inBay(t) && typeof p.carry === 'number') {
        this.put(p, p.carry, { x: bayX(t % 5), y: LVY[t >= 5 ? 1 : 0], z: RACK_Z })
        p.rack[t] = p.carry; p.carry = null; p.stored++
        this.emit({ type: 'place', p: p.id })
        this.say(p, '+1', undefined, true, { x: bayX(t % 5), y: 2.9, z: RK.z1 })
        if (p.stored >= N) { p.stage = 4; this.emit({ type: 'stage', p: p.id }); this.say(p, 'ได้ใบสั่งส่งสินค้า!', undefined, true) }
        return
      }
      if (manual) this.hint(p, 'ไปช่องที่กระพริบในแร็ค')
      return
    }
    if (p.stage === 4) {
      if (p.carry === null) {
        const o = p.orders[p.picked]
        if (inBay(o)) { p.carry = p.rack[o]; p.rack[o] = -1; this.put(p, p.carry, 'fork'); this.emit({ type: 'pick', p: p.id }); return }
        if (manual) this.hint(p, 'ไปช่องที่กระพริบในแร็ค')
        return
      }
      const s = slotPos(4, p.picked)
      if (dist(fx, fz, s.x, s.z) < 0.8 * k && typeof p.carry === 'number') {
        this.put(p, p.carry, { x: s.x, z: s.z })
        p.s4[p.picked] = p.carry; p.carry = null; p.picked++
        this.emit({ type: 'place', p: p.id })
        this.say(p, '+1', undefined, true, { x: s.x, y: 1.4, z: s.z })
        if (p.picked >= N) { p.stage = 5; this.emit({ type: 'stage', p: p.id }); this.say(p, 'โหลดเข้าตู้ได้เลย!', undefined, true) }
        return
      }
      if (manual) this.hint(p, 'ไปที่ช่องที่กระพริบ')
      return
    }
    if (p.stage === 5) {
      if (p.carry === null) {
        for (let i = 0; i < N; i++) {
          if (p.s4[i] < 0) continue
          const s = slotPos(4, i)
          if (dist(fx, fz, s.x, s.z) < 0.8 * k) { p.carry = p.s4[i]; p.s4[i] = -1; this.put(p, p.carry, 'fork'); this.emit({ type: 'pick', p: p.id }); return }
        }
        if (manual) this.hint(p, 'ขับไปตักพาเลทที่จุด 4')
        return
      }
      if (fz > 12.45 - (manual ? 0.4 : 0) && Math.abs(fx) < 1.3 && typeof p.carry === 'number') {
        const c = p.loaded % 2, r = Math.floor(p.loaded / 2)
        this.put(p, p.carry, { x: c ? 0.65 : -0.65, y: 0.12, z: 19.2 - r * 1.15 })
        p.carry = null; p.loaded++
        this.emit({ type: 'place', p: p.id })
        this.say(p, p.loaded + '/' + N, undefined, true, { x: 0, y: 2.6, z: 13 })
        if (p.loaded >= N) this.finish(p)
        return
      }
      if (manual) this.hint(p, 'ขับเข้าตู้ที่จุด 5')
    }
  }

  private finish(p: Player): void {
    p.finished = true; p.finishTime = this.elapsed; p.place = ++this.finishOrder
    this.emit({ type: 'finish', p: p.id })
    this.say(p, 'สำเร็จ!', undefined, true)
    if (this.players.filter(q => q.active).every(q => q.finished)) this.endTimer = 2
  }

  end(): void {
    if (this.state === 'over') return
    this.state = 'over'
    this.emit({ type: 'end' })
  }

  /** Fork target height: auto-raises in front of the destination/order rack bay. */
  private forkTarget(p: Player): number {
    let ty = p.carry !== null ? FORK_CARRY : FORK_REST
    const near = (c: number) => Math.abs(p.x - bayX(c % 5)) < 1.7 && p.z < 3
    if (p.stage === 3 && p.carry !== null) { const c = p.rt[p.stored]; if (near(c)) ty = LVY[c >= 5 ? 1 : 0] }
    if (p.stage === 4 && p.carry === null) { const c = p.orders[p.picked]; if (near(c)) ty = LVY[c >= 5 ? 1 : 0] }
    return ty
  }

  step(dt: number, inputs: PlayerInput[]): void {
    if (this.state === 'pause' || this.state === 'menu') return
    if (this.state === 'count') {
      this.countT -= dt
      const n = Math.ceil(this.countT)
      if (n !== this.lastCount) { this.lastCount = n; if (n >= 2) this.emit({ type: 'tick' }); else if (n === 1) this.emit({ type: 'go' }) }
      if (this.countT <= 1) this.state = 'play'
    }
    for (const p of this.players) {
      if (!p.active) continue
      p.px = p.x; p.pz = p.z; p.pang = p.ang
      const I = inputs[p.id] ?? { x: 0, y: 0, a: false }
      const press = I.a && !p.aHeld
      p.aHeld = I.a
      p.hintCd -= dt; p.bumpCd -= dt; p.stun -= dt; p.shake = Math.max(0, p.shake - dt)
      const playing = this.state === 'play' && !p.finished
      const sp = playing && p.stun <= 0 ? { walk: CONFIG.move.walk, jack: CONFIG.move.jack, fork: CONFIG.move.fork }[p.mode] : 0
      let ix = I.x, iy = I.y
      const m = Math.hypot(ix, iy)
      if (m > 1) { ix /= m; iy /= m }
      const kk = 1 - Math.exp(-dt * CONFIG.move.accel)
      p.vx += (ix * sp - p.vx) * kk
      p.vz += (iy * sp - p.vz) * kk
      if (m > 0.15 && sp > 0) {
        const ta = Math.atan2(ix, iy)
        let d = ta - p.ang
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        p.ang += d * (1 - Math.exp(-dt * (p.mode === 'walk' ? CONFIG.move.turnWalk : CONFIG.move.turnVehicle)))
        // keep the angle in -PI..PI so the renderer's blend never spins the long way round
        if (p.ang > Math.PI) p.ang -= Math.PI * 2
        else if (p.ang < -Math.PI) p.ang += Math.PI * 2
      }
      p.x += p.vx * dt; p.z += p.vz * dt
      const r = p.mode === 'walk' ? 0.35 : 0.5
      const cxl = clamp(p.x, -LANE_HX + r, LANE_HX - r), czl = clamp(p.z, -12.75 + r, 12.75 - r)
      if (cxl !== p.x) { p.x = cxl; p.vx = 0 }
      if (czl !== p.z) { p.z = czl; p.vz = 0 }
      let hit = false, hitVn = 0
      const cx = clamp(p.x, RK.x0, RK.x1), cz = clamp(p.z, RK.z0, RK.z1)
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz)
      if (d < r) {
        hit = true
        if (d < 1e-4) p.z = p.z < RACK_Z ? RK.z0 - r : RK.z1 + r
        else { p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r }
        // slide along the rack: drop only the part of the velocity that points into it (no bounce)
        const nx = d < 1e-4 ? 0 : dx / d, nz = d < 1e-4 ? (p.z < RACK_Z ? -1 : 1) : dz / d
        const vn = p.vx * nx + p.vz * nz
        if (vn < 0) { hitVn = -vn; p.vx -= vn * nx; p.vz -= vn * nz }
      }
      const spd = Math.hypot(p.vx, p.vz)
      p.travel += spd * dt
      if (hit && playing && p.mode !== 'walk' && hitVn > CONFIG.move.bumpSpeed * 0.75 && p.bumpCd <= 0) {
        p.penalty += PEN_BUMP; p.bumps++; p.bumpCd = 1.5; p.stun = 0.3; p.shake = 0.3; p.vx = 0; p.vz = 0
        this.emit({ type: 'bump', p: p.id })
        this.say(p, p.carry !== null ? 'ระวังของตก! +3 วิ' : 'ชน! +3 วิ', '#ff4d4d', true)
      }
      if (p.mode === 'fork') {
        const ty = this.forkTarget(p)
        p.forkY += clamp(ty - p.forkY, -2.6 * dt, 2.6 * dt)
      }
      if (playing) {
        this.interact(p, false)
        if (press) this.interact(p, true)
      }
    }
    if (this.state === 'play') {
      this.timeLeft -= dt
      this.elapsed += dt
      if (this.endTimer > 0) { this.endTimer -= dt; if (this.endTimer <= 0) this.end() }
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.end() }
    }
  }
}
