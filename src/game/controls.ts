import type { PlayerInput } from './sim'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const KEYMAP = [
  { u: ['KeyW'], d: ['KeyS'], l: ['KeyA'], r: ['KeyD'], a: ['Space', 'KeyF'] },
  { u: ['ArrowUp'], d: ['ArrowDown'], l: ['ArrowLeft'], r: ['ArrowRight'], a: ['Enter', 'ShiftRight'] },
  { u: ['KeyI'], d: ['KeyK'], l: ['KeyJ'], r: ['KeyL'], a: ['KeyU', 'KeyO'] },
  { u: ['Numpad8'], d: ['Numpad5', 'Numpad2'], l: ['Numpad4'], r: ['Numpad6'], a: ['Numpad0', 'NumpadEnter'] },
]

/** Per-player keyboard + gamepad + on-screen pad state, merged like the original game. */
export class Controls {
  readonly keys = new Set<string>()
  readonly pads = [0, 1, 2, 3].map(() => ({ jx: 0, jy: 0, btn: 0 }))
  private menuPrev = false
  onMenuButton?: () => void
  /** Joystick → player binding: slots[player] = Gamepad.index, set by pressing a button on the menu. */
  readonly slots: (number | null)[] = [null, null, null, null]
  /** Last time (ms) each player's joystick was touched; the menu uses it to flash that colour. */
  readonly activeAt = [0, 0, 0, 0]
  joinEnabled = true
  onJoin?: (player: number) => void
  private prevAny = new Map<number, boolean>()

  clearSlots(): void { this.slots.fill(null) }

  /** Give an unbound joystick the next free colour (menu only). */
  tryJoin(g: Gamepad): void {
    if (!this.joinEnabled || this.slots.includes(g.index)) return
    const free = this.slots.indexOf(null)
    if (free < 0) return
    this.slots[free] = g.index
    this.activeAt[free] = performance.now()
    try { void (g as Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }).vibrationActuator?.playEffect?.('dual-rumble', { duration: 200, strongMagnitude: 0.6, weakMagnitude: 0.6 }) } catch { /* optional */ }
    this.onJoin?.(free)
  }

  private padFor(i: number, gps: Gamepad[]): Gamepad | undefined {
    if (this.slots.some(s => s !== null)) return this.slots[i] === null ? undefined : gps.find(g => g.index === this.slots[i])
    return gps[i]
  }

  constructor() {
    // Chrome/Edge announce a joystick on its first button press: bind it straight away.
    addEventListener('gamepadconnected', e => this.tryJoin((e as GamepadEvent).gamepad))
    addEventListener('keydown', e => {
      this.keys.add(e.code)
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
    })
    addEventListener('keyup', e => this.keys.delete(e.code))
    addEventListener('blur', () => this.keys.clear())
  }

  gamepads(): Gamepad[] {
    try { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((g): g is Gamepad => !!g) } catch { return [] }
  }

  read(): PlayerInput[] {
    const gps = this.gamepads()
    const any = (codes: string[]) => codes.some(c => this.keys.has(c))
    return [0, 1, 2, 3].map(i => {
      const k = KEYMAP[i]
      let x = 0, y = 0, a = false
      if (any(k.l)) x -= 1
      if (any(k.r)) x += 1
      if (any(k.u)) y -= 1
      if (any(k.d)) y += 1
      if (any(k.a)) a = true
      x += this.pads[i].jx; y += this.pads[i].jy
      if (this.pads[i].btn > 0) a = true
      const g = this.padFor(i, gps)
      if (g) {
        let gx = g.axes[0] || 0, gy = g.axes[1] || 0
        if (Math.hypot(gx, gy) < 0.22) { gx = 0; gy = 0 }
        const [hx, hy] = hat(g)
        gx += hx; gy += hy
        x += gx; y += gy
        const b = g.buttons
        if (b[14]?.pressed) x -= 1
        if (b[15]?.pressed) x += 1
        if (b[12]?.pressed) y -= 1
        if (b[13]?.pressed) y += 1
        if ([0, 1, 2, 3].some(n => b[n]?.pressed)) a = true
      }
      return { x: clamp(x, -1, 1), y: clamp(y, -1, 1), a }
    })
  }

  /** A/Start on any gamepad acts like the menu's main button. Returns connected pad count. */
  pollMenu(): number {
    const gps = this.gamepads()
    const now = performance.now()
    for (const g of gps) {
      const btn = g.buttons.some(b => b.pressed)
      const [hx, hy] = hat(g)
      const moved = btn || Math.hypot(g.axes[0] || 0, g.axes[1] || 0) > 0.5 || hx !== 0 || hy !== 0
      const slot = this.slots.indexOf(g.index)
      if (slot >= 0 && moved) this.activeAt[slot] = now
      // Joining: the first button press of an unbound joystick takes the next free colour.
      if (slot < 0 && btn && !this.prevAny.get(g.index)) this.tryJoin(g)
      this.prevAny.set(g.index, btn)
    }
    // Forget joysticks that were unplugged so their colour can be reused.
    this.slots.forEach((s, i) => { if (s !== null && !gps.some(g => g.index === s)) this.slots[i] = null })
    const pressed = gps.some(g => g.buttons[9]?.pressed && this.slots.includes(g.index))
    if (pressed && !this.menuPrev) this.onMenuButton?.()
    this.menuPrev = pressed
    return gps.length
  }
}

/** Many USB arcade-stick encoders report the lever as a POV hat on axis 9 instead of axes 0/1. */
function hat(g: Gamepad): [number, number] {
  if (g.axes.length < 10) return [0, 0]
  const v = g.axes[9]
  if (v === undefined || v > 1.05 || v < -1.05) return [0, 0]
  const dirs: [number, number, number][] = [[-1, 0, -1], [-0.714, 1, -1], [-0.428, 1, 0], [-0.143, 1, 1], [0.143, 0, 1], [0.428, -1, 1], [0.714, -1, 0], [1, -1, -1]]
  for (const [t, x, y] of dirs) if (Math.abs(v - t) < 0.08) return [x, y]
  return [0, 0]
}
