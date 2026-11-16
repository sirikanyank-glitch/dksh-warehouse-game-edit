import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { cullTriangles, fit, prepMaterials, type Models } from './models'
import { BAY, PLAYER_COLORS, PSPOT, RK, Z2, Z4, ZONE_COLORS, bayX, laneX, slotPos } from './layout'

export const FONT = "Kanit, 'Noto Sans Thai', Thonburi, sans-serif"
const matCache = new Map<string, THREE.MeshStandardMaterial>()
export function mat(color: string, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(o)
  let m = matCache.get(key)
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o }); matCache.set(key, m) }
  return m
}
const geoCache = new Map<string, THREE.BoxGeometry>()
export const boxGeo = (w: number, h: number, d: number): THREE.BoxGeometry => {
  const k = `${w},${h},${d}`
  let g = geoCache.get(k)
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g) }
  return g
}
export function box(w: number, h: number, d: number, m: THREE.Material | string, x: number, y: number, z: number, parent: THREE.Object3D, shadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), typeof m === 'string' ? mat(m) : m)
  mesh.position.set(x, y, z)
  mesh.castShadow = shadow
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}
let brandMat: THREE.MeshStandardMaterial | undefined
/** Red DKSH company sign with white lettering (shared by every lane). */
function brandSignMat(): THREE.MeshStandardMaterial {
  if (brandMat) return brandMat
  const tex = canvasTex(512, 192, (g, w, h) => {
    g.fillStyle = '#e30613'; g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 6; g.strokeRect(12, 12, w - 24, h - 24)
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = '900 108px "Arial Black", "Helvetica Neue", Arial, sans-serif'
    g.fillText('DKSH', w / 2, h / 2 - 14, w - 60)
    g.font = `600 30px ${FONT}`
    g.fillText('คลังสินค้า · WAREHOUSE', w / 2, h / 2 + 56, w - 60)
  })
  brandMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.18 })
  return brandMat
}
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat) }
  return t
}
const noise = (g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number, size = 2) => {
  for (let k = 0; k < n; k++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 1.4})`
    g.fillRect(Math.random() * w, Math.random() * h, size, size)
  }
}

export class World {
  readonly root = new THREE.Group()
  readonly sun: THREE.DirectionalLight
  private floorMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, envMapIntensity: 0.15 })
  private lamps: THREE.MeshStandardMaterial

  constructor(readonly scene: THREE.Scene, renderer: THREE.WebGLRenderer, private models: Models, shadowSize: number) {
    scene.background = new THREE.Color('#9aa5aa')
    scene.fog = new THREE.Fog('#9aa5aa', 95, 190)
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.22
    pmrem.dispose()
    scene.add(this.root)
    scene.add(new THREE.HemisphereLight('#eef3ff', '#7d868b', 0.85))
    const sun = new THREE.DirectionalLight('#fff1dc', 1.9)
    sun.position.set(16, 34, 20)
    sun.target.position.set(0, 0, 2)
    sun.castShadow = true
    sun.shadow.mapSize.set(shadowSize, shadowSize)
    Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27, near: 1, far: 100 })
    sun.shadow.bias = -0.0012
    sun.shadow.normalBias = 0.07
    scene.add(sun, sun.target)
    this.sun = sun
    const fill = new THREE.DirectionalLight('#cfe3ff', 0.5)
    fill.position.set(-20, 18, -10)
    scene.add(fill)
    this.lamps = mat('#ffe27a', { emissive: '#ffb300', emissiveIntensity: 0.9 })

    this.buildGround()
    this.buildWalls()
    this.buildRacks()
    this.buildTrucks()
    this.buildContainers()
  }

  private buildGround(): void {
    const asphalt = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#5f676b'; g.fillRect(0, 0, w, h); noise(g, w, h, 16000, 0.07, 2)
    }, [30, 26])
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 130), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.95 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.07
    ground.receiveShadow = true
    this.root.add(ground)
    for (const x of [-20, -10, 0, 10, 20]) for (const z of [-19.5, 19]) box(0.14, 0.01, 11, '#eef0ec', x, -0.06, z, this.root, false)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 26), this.floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.root.add(floor)
    box(40.5, 0.05, 26.5, '#8f979a', 0, -0.045, 0, this.root, false)
  }

  /** Floor paint depends on the pallet count (one or two slot rows). */
  paintFloor(pallets: number): void {
    const PX = 56, Wp = 40 * PX, Hp = 26 * PX
    this.floorMat.map?.dispose()
    this.floorMat.map = canvasTex(Wp, Hp, g => {
      const P = (x: number, z: number): [number, number] => [(x + 20) * PX, (z + 13) * PX]
      const grad = g.createLinearGradient(0, 0, Wp, Hp)
      grad.addColorStop(0, '#bfc6c8'); grad.addColorStop(1, '#b1b9bc')
      g.fillStyle = grad; g.fillRect(0, 0, Wp, Hp)
      for (let k = 0; k < 70; k++) {
        const x = Math.random() * Wp, y = Math.random() * Hp, r = 30 + Math.random() * 150
        const rg = g.createRadialGradient(x, y, 0, x, y, r)
        rg.addColorStop(0, `rgba(80,92,98,${0.03 + Math.random() * 0.05})`); rg.addColorStop(1, 'rgba(80,92,98,0)')
        g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2)
      }
      noise(g, Wp, Hp, 30000, 0.03, 2)
      // tyre marks
      g.strokeStyle = 'rgba(40,44,46,.05)'; g.lineWidth = 0.12 * PX
      for (let k = 0; k < 18; k++) {
        const x = Math.random() * Wp, y = Math.random() * Hp
        g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 80, y + 120, x - 60, y + 260, x + 40, y + 380); g.stroke()
      }
      g.strokeStyle = 'rgba(60,72,78,.18)'; g.lineWidth = 2
      for (let x = 0; x <= 40; x += 5) { g.beginPath(); g.moveTo(x * PX, 0); g.lineTo(x * PX, Hp); g.stroke() }
      for (let z = 0; z <= 26; z += 5) { g.beginPath(); g.moveTo(0, z * PX); g.lineTo(Wp, z * PX); g.stroke() }
      const rows = pallets > 5 ? 2 : 1, line = '#f2c200'
      const rect = (x: number, z: number, w: number, d: number, c: string, lw: number) => {
        const [a, b] = P(x - w / 2, z - d / 2); g.strokeStyle = c; g.lineWidth = lw * PX; g.strokeRect(a, b, w * PX, d * PX)
      }
      const hatch = (x: number, z: number, w: number, d: number) => {
        const [a, b] = P(x - w / 2, z - d / 2)
        g.save(); g.beginPath(); g.rect(a, b, w * PX, d * PX); g.clip()
        g.strokeStyle = 'rgba(242,194,0,.85)'; g.lineWidth = 0.1 * PX
        for (let s = -d * PX; s < w * PX; s += 0.4 * PX) { g.beginPath(); g.moveTo(a + s, b + d * PX); g.lineTo(a + s + d * PX, b); g.stroke() }
        g.restore()
      }
      const badge = (x: number, z: number, n: number) => {
        const [a, b] = P(x, z)
        g.fillStyle = '#fff'; g.beginPath(); g.arc(a, b, 0.62 * PX, 0, 7); g.fill()
        g.fillStyle = ZONE_COLORS[n - 1]; g.beginPath(); g.arc(a, b, 0.52 * PX, 0, 7); g.fill()
        g.fillStyle = '#fff'; g.font = `800 ${0.68 * PX}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), a, b + 2)
      }
      for (let i = 0; i < 4; i++) {
        const lx = laneX(i)
        g.fillStyle = PLAYER_COLORS[i] + '18'; const [ax] = P(lx - 5, 0); g.fillRect(ax, 0, 10 * PX, Hp)
        g.strokeStyle = ZONE_COLORS[0]; g.lineWidth = 0.09 * PX; g.setLineDash([0.35 * PX, 0.25 * PX])
        const [tx, tz] = P(lx, -13); g.beginPath(); g.arc(tx, tz, 2.1 * PX, 0, Math.PI); g.stroke(); g.setLineDash([])
        rect(lx + PSPOT.x, PSPOT.z, 1.6, 1.4, line, 0.1); badge(lx + 3.3, -10.6, 1)
        for (const zn of [2, 4] as const) {
          const ys = zn === 2 ? Z2 : Z4, z0 = ys[0] - 0.85, z1 = ys[rows - 1] + 0.85
          rect(lx, (z0 + z1) / 2, 9.3, z1 - z0, line, 0.1)
          for (let k = 0; k < pallets; k++) { const s = slotPos(zn, k); rect(lx + s.x, s.z, 1.5, 1.3, 'rgba(242,194,0,.95)', 0.06) }
          badge(lx + 3.3, ys[0] - 1.55, zn)
        }
        const [a1, b1] = P(lx + RK.x0 - 0.3, RK.z1 + 0.25); g.fillStyle = line; g.fillRect(a1, b1, (RK.x1 - RK.x0 + 0.6) * PX, 0.1 * PX)
        hatch(lx + RK.x0 - 0.75, (RK.z0 + RK.z1) / 2, 0.7, RK.z1 - RK.z0 + 0.3)
        hatch(lx + RK.x1 + 0.75, (RK.z0 + RK.z1) / 2, 0.7, RK.z1 - RK.z0 + 0.3)
        g.font = `700 ${0.5 * PX}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(30,50,58,.6)'
        for (let b = 0; b < 5; b++) { const [a, c] = P(lx + bayX(b), RK.z1 + 0.75); g.fillText(String(b + 1), a, c) }
        badge(lx + 4.1, 0.4, 3)
        g.strokeStyle = ZONE_COLORS[4]; g.lineWidth = 0.09 * PX; g.setLineDash([0.35 * PX, 0.25 * PX])
        const [dx, dz] = P(lx, 13); g.beginPath(); g.arc(dx, dz, 2.1 * PX, Math.PI, 0); g.stroke(); g.setLineDash([])
        badge(lx + 3.3, 11.5, 5)
      }
      g.strokeStyle = line; g.lineWidth = 0.12 * PX; g.setLineDash([0.6 * PX, 0.4 * PX])
      for (const x of [-10, 0, 10]) { const [a] = P(x, 0); g.beginPath(); g.moveTo(a, 0.6 * PX); g.lineTo(a, Hp - 0.6 * PX); g.stroke() }
      g.setLineDash([])
    })
    this.floorMat.needsUpdate = true
  }

  private buildWalls(): void {
    const panelTex = (rx: number, ry: number) => canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#2a8a90'; g.fillRect(0, 0, w, h)
      for (let x = 0; x < w; x += 16) {
        const lg = g.createLinearGradient(x, 0, x + 16, 0)
        lg.addColorStop(0, 'rgba(0,0,0,.2)'); lg.addColorStop(0.5, 'rgba(255,255,255,.16)'); lg.addColorStop(1, 'rgba(0,0,0,.2)')
        g.fillStyle = lg; g.fillRect(x, 0, 16, h)
      }
      g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, 0, w, 3)
      noise(g, w, h, 1500, 0.04)
    }, [rx, ry])
    const concrete = mat('#a5abae', { roughness: 0.95 })
    const cap = mat('#e8ecee', { roughness: 0.5, metalness: 0.4 })
    const steel = mat('#4b545a', { roughness: 0.45, metalness: 0.6 })
    const seg = (x0: number, x1: number, z: number, h: number) => {
      if (x1 - x0 < 0.01) return
      const w = x1 - x0
      const m = new THREE.Mesh(boxGeo(w, h, 0.3), new THREE.MeshStandardMaterial({ map: panelTex(w / 2.2, 1), roughness: 0.6, metalness: 0.25 }))
      m.position.set((x0 + x1) / 2, h / 2, z); m.receiveShadow = true; m.castShadow = z < 0
      this.root.add(m)
      box(w, 0.35, 0.34, concrete, (x0 + x1) / 2, 0.175, z, this.root)
    }
    const op = 1.6
    let x = -20.15
    for (let i = 0; i < 4; i++) {
      const lx = laneX(i)
      seg(x, lx - op, -13, 2.8)
      box(op * 2, 0.65, 0.3, new THREE.MeshStandardMaterial({ map: panelTex(1.5, 0.3), roughness: 0.6, metalness: 0.25 }), lx, 2.475, -13, this.root)
      x = lx + op
    }
    seg(x, 20.15, -13, 2.8)
    box(40.3, 0.1, 0.38, cap, 0, 2.85, -13, this.root)
    for (const px of [-20, -10, 0, 10, 20]) box(0.22, 2.9, 0.22, steel, px, 1.45, -12.8, this.root)
    x = -20.15
    for (let i = 0; i < 4; i++) { const lx = laneX(i); seg(x, lx - op, 13, 1.0); x = lx + op }
    seg(x, 20.15, 13, 1.0)
    const bollard = new THREE.CylinderGeometry(0.1, 0.1, 0.9, 16)
    for (let i = 0; i < 4; i++) {
      const lx = laneX(i)
      for (const s of [-1, 1]) {
        box(0.5, 0.08, 0.34, cap, lx + s * (op + 0.25), 1.04, 13, this.root)
        const post = new THREE.Mesh(bollard, mat('#f2c200', { roughness: 0.45 }))
        post.position.set(lx + s * (op + 0.35), 0.45, 12.55); post.castShadow = true; this.root.add(post)
        box(0.21, 0.1, 0.21, '#1d1d1d', lx + s * (op + 0.35), 0.66, 12.55, this.root, false)
      }
    }
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(boxGeo(0.3, 2.0, 26.3), new THREE.MeshStandardMaterial({ map: panelTex(12, 0.8), roughness: 0.6, metalness: 0.25 }))
      m.position.set(s * 20, 1.0, 0); m.castShadow = m.receiveShadow = true; this.root.add(m)
      box(0.34, 0.1, 26.3, cap, s * 20, 2.05, 0, this.root)
      for (let z = -10; z <= 10; z += 5) {
        box(0.05, 0.4, 1.4, mat('#9fc4d6', { roughness: 0.12, metalness: 0.3 }), s * 19.83, 1.55, z, this.root, false)
        box(0.06, 0.48, 0.06, steel, s * 19.82, 1.55, z, this.root, false)
      }
      for (const z of [-7.5, 7.5]) {
        box(0.05, 0.5, 0.35, mat('#d8262b'), s * 19.82, 1.0, z, this.root, false)
        box(0.06, 0.12, 0.3, mat('#ffffff'), s * 19.81, 1.32, z, this.root, false)
      }
    }
    const stripe = canvasTex(32, 256, (g, w, h) => {
      for (let y = 0; y < h; y += 32) { g.fillStyle = (y / 32) % 2 ? '#1d1d1d' : '#f6c400'; g.fillRect(0, y, w, 32) }
    })
    const stripeMat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 })
    const drumGeo = new THREE.CylinderGeometry(0.2, 0.2, 3.3, 20)
    for (let i = 0; i < 4; i++) {
      const lx = laneX(i)
      for (const s of [-1, 1]) {
        box(0.14, 2.15, 0.34, stripeMat, lx + s * (op - 0.07), 1.075, -13, this.root)
        box(0.25, 0.45, 0.22, mat('#1b1b1b', { roughness: 0.9 }), lx + s * 1.25, 0.6, -12.75, this.root)
        box(0.18, 0.14, 0.1, this.lamps, lx + s * 1.95, 2.05, -12.8, this.root, false)
      }
      const drum = new THREE.Mesh(drumGeo, mat('#b4bec2', { roughness: 0.4, metalness: 0.7 }))
      drum.rotation.z = Math.PI / 2; drum.position.set(lx, 2.0, -12.95); drum.castShadow = true; this.root.add(drum)
      box(3.0, 0.03, 0.9, mat('#6b757a', { roughness: 0.5, metalness: 0.7 }), lx, 0.015, -12.55, this.root, false)
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.42), new THREE.MeshBasicMaterial({ map: canvasTex(190, 84, (g, w, h) => {
        g.fillStyle = '#f6c400'; g.fillRect(0, 0, w, h); g.strokeStyle = '#16262c'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6)
        g.fillStyle = '#16262c'; g.font = `800 56px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('D' + (i + 1), w / 2, h / 2 + 3)
      }) }))
      sign.position.set(lx, 2.5, -12.84); this.root.add(sign)
      // Company signage either side of every dock door.
      for (const sx of [-1, 1]) {
        const brand = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.86), brandSignMat())
        brand.position.set(lx + sx * 3.25, 1.75, -12.84); this.root.add(brand)
      }
    }
  }

  private buildRacks(): void {
    const upright = canvasTex(32, 256, (g, w, h) => {
      g.fillStyle = '#1f5fae'; g.fillRect(0, 0, w, h)
      g.fillStyle = '#0d2c52'
      for (let y = 6; y < h; y += 12) { g.fillRect(8, y, 5, 7); g.fillRect(19, y, 5, 7) }
    })
    const upMat = new THREE.MeshStandardMaterial({ map: upright, roughness: 0.45, metalness: 0.5 })
    const braceMat = mat('#1f5fae', { metalness: 0.5, roughness: 0.5 })
    const beamMat = mat('#ff7a1a', { roughness: 0.4, metalness: 0.4 })
    const deckTex = canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = '#c3cbcf'; g.lineWidth = 3
      for (let x = 4; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke() }
      for (let y = 4; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke() }
    }, [8, 2])
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, transparent: true, alphaTest: 0.3, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide })
    const guard = mat('#f2c200', { roughness: 0.5 })
    const D = RK.z1 - RK.z0, CZ = (RK.z0 + RK.z1) / 2
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group(); g.position.x = laneX(i); this.root.add(g)
      for (let k = 0; k <= 5; k++) {
        const x = RK.x0 + k * BAY
        for (const z of [RK.z0, RK.z1]) {
          box(0.09, 2.62, 0.09, upMat, x, 1.31, z, g)
          box(0.2, 0.02, 0.2, mat('#3a4247', { metalness: 0.6, roughness: 0.4 }), x, 0.01, z, g, false)
        }
        for (const y of [0.55, 1.6]) {
          const br = box(0.035, 0.035, Math.hypot(D, 0.8), braceMat, x, y, CZ, g, false)
          br.rotation.x = Math.atan2(0.8, D)
        }
        box(0.05, 0.05, D, braceMat, x, 0.15, CZ, g, false)
      }
      for (const z of [RK.z0, RK.z1]) for (const y of [1.24, 2.55]) box(RK.x1 - RK.x0 + 0.1, 0.12, 0.07, beamMat, 0, y, z, g)
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(RK.x1 - RK.x0, D), deckMat)
      deck.rotation.x = -Math.PI / 2; deck.position.set(0, 1.3, CZ); deck.receiveShadow = true; g.add(deck)
      for (const s of [-1, 1]) box(0.12, 0.4, D + 0.3, guard, s * (RK.x1 + 0.22), 0.2, CZ, g)
      for (let b = 0; b < 5; b++) for (const lv of [0, 1]) {
        const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.1), new THREE.MeshBasicMaterial({ map: canvasTex(128, 32, (c, w, h) => {
          c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.fillStyle = '#16262c'; c.font = `700 22px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'
          c.fillText(`${lv ? 'บน' : 'ล่าง'}-${b + 1}`, w / 2, h / 2 + 1)
        }) }))
        lbl.position.set(bayX(b), lv ? 2.55 : 1.24, RK.z1 + 0.04)
        g.add(lbl)
      }
    }
  }

  private buildTrucks(): void {
    const truckSrc = this.models.truck.scene
    prepMaterials(truckSrc, 0.55, 0.2)
    const cartonSrc = this.models.carton.scene
    prepMaterials(cartonSrc, 0.85)
    for (let i = 0; i < 4; i++) {
      const lx = laneX(i)
      const t = fit(truckSrc.clone(true), -Math.PI / 2, { x: 3.0, y: 3.4, z: 10.5 })
      t.position.set(lx, 0, -13.35 - 5.25)
      this.root.add(t)
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const b = fit(cartonSrc.clone(true), (r + c) % 2 ? 0 : Math.PI / 2, { x: 0.58, y: 0.5, z: 0.5 })
        b.position.set(lx + (c - 1) * 0.68, 1.0 + r * 0.52, -14.1 - (c % 2) * 0.1)
        this.root.add(b)
      }
    }
  }

  private buildContainers(): void {
    const src = this.models.container.scene
    prepMaterials(src, 0.6, 0.25)
    // Remove the roof so loaded pallets stay visible from the high camera (open-top container).
    cullTriangles(src, (c, b) => c.y > b.max.y - (b.max.y - b.min.y) * 0.07)
    for (let i = 0; i < 4; i++) {
      const lx = laneX(i)
      const c = fit(src.clone(true), Math.PI / 2, { x: 3.0, y: 2.6, z: 7.4 })
      c.position.set(lx, 0, 13.25 + 3.7)
      this.root.add(c)
      const ramp = box(2.4, 0.05, 0.9, mat('#6b757a', { roughness: 0.45, metalness: 0.7 }), lx, 0.08, 13.2, this.root, false)
      ramp.rotation.x = -0.1
    }
  }

  /** Dock warning lamps pulse gently. */
  animate(t: number): void {
    this.lamps.emissiveIntensity = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3))
  }
}
