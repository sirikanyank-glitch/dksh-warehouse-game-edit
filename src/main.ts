import './styles/main.css'
import { Audio } from './engine/audio'
import { Assets } from './engine/assets'
import { GameLoop } from './engine/loop'
import { Renderer, suggestQuality } from './engine/renderer'
import { Controls } from './game/controls'
import { Game } from './game/game'
import { PLAYER_COLORS, PLAYER_NAMES, STAGE_NAMES } from './game/layout'
import { loadModels } from './game/models'
import { hudHint, progressOf, rank, scoreOf, starsOf, type Settings } from './game/sim'

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!
const STORE = 'dockshift.v1'
type Saved = Settings & { muted: boolean; pads: boolean | null; follow?: boolean }

function loadSaved(): Saved {
  const d: Saved = { players: 4, pallets: 5, minutes: 7, muted: false, pads: null }
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null')
    if (s && typeof s === 'object') {
      if ([1, 2, 3, 4].includes(s.players)) d.players = s.players
      if ([3, 5, 10].includes(s.pallets)) d.pallets = s.pallets
      if ([5, 7, 10].includes(s.minutes)) d.minutes = s.minutes
      d.muted = !!s.muted
      if (typeof s.pads === 'boolean') d.pads = s.pads
    }
  } catch { /* storage unavailable */ }
  return d
}

async function boot(): Promise<void> {
  const saved = loadSaved()
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)) } catch { /* ignore */ } }
  const touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  // On-screen drag pads work with touch and with a mouse (computers without keyboard play).
  let showPads = saved.pads ?? true
  void touchDevice
  const audio = new Audio()
  audio.muted = saved.muted
  const controls = new Controls()
  const assets = new Assets()
  const bar = $('#bootBar')
  const models = await loadModels(assets, f => { bar.style.width = `${10 + f * 85}%` })
  await document.fonts.ready
  const canvas = $<HTMLCanvasElement>('#game')
  const renderer = new Renderer(canvas, suggestQuality())
  const settings = (): Settings => ({ players: saved.players, pallets: saved.pallets, minutes: saved.minutes })
  const game = new Game(renderer, models, controls, audio, $('#fxl'), settings())
  const sim = game.sim

  // ---------- HUD ----------
  type HudEl = { st: HTMLElement; hn: HTMLElement; cnt: HTMLElement; pips: HTMLElement[]; last: string }
  let hudEls: HudEl[] = []
  const buildHud = () => {
    const h = $('#hud')
    h.innerHTML = ''; h.style.setProperty('--np', String(saved.players))
    hudEls = []
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('div')
      c.className = 'card' + (i < saved.players ? '' : ' off')
      c.style.backgroundColor = PLAYER_COLORS[i]
      c.innerHTML = `<div class="num" style="color:${PLAYER_COLORS[i]}">${i + 1}</div><div class="st"></div><div class="cnt"></div><div class="hn"></div>`
      if (i >= saved.players && window.innerWidth <= 640) c.hidden = true
      h.appendChild(c)
      hudEls.push({ st: c.querySelector('.st')!, hn: c.querySelector('.hn')!, cnt: c.querySelector('.cnt')!, pips: [], last: '' })
    }
  }
  const fmt = (s: number) => { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
  const updateHud = () => {
    const N = sim.settings.pallets
    sim.players.forEach((p, i) => {
      const e = hudEls[i]
      if (!e) return
      const st = p.active ? (p.finished ? 'เสร็จ! อันดับ ' + p.place : `${p.stage}/5 ${STAGE_NAMES[p.stage - 1]}`) : ''
      const hn = hudHint(p)
      const cnt = p.active ? `${progressOf(p, N)}/${N}${p.penalty ? `<small>+${p.penalty}วิ</small>` : ''}` : ''
      const key = st + hn + cnt + p.stage + p.finished
      if (key === e.last) return
      e.last = key
      e.st.textContent = st
      e.hn.textContent = hn
      e.cnt.innerHTML = cnt
      e.pips.forEach((q, k) => { q.className = p.active && (p.finished || k < p.stage - 1) ? 'done' : p.active && k === p.stage - 1 ? 'cur' : '' })
    })
    const tl = Math.ceil(sim.state === 'menu' ? sim.settings.minutes * 60 : sim.timeLeft)
    const tm = $('#timer')
    const s = fmt(tl)
    if (tm.textContent !== s) tm.textContent = s
    tm.classList.toggle('low', sim.state === 'play' && tl <= 30)
    const cnt = $('#count')
    if (sim.state === 'count') {
      const n = Math.ceil(sim.countT) - 1
      cnt.hidden = false
      const t = n >= 1 ? String(n) : 'ลุย!'
      if (cnt.textContent !== t) cnt.textContent = t
    } else cnt.hidden = true
  }

  // ---------- touch pads: put a finger anywhere in the left area, drag to drive ----------
  // A player whose joystick is bound doesn't need the on-screen pad; hide it so the game view grows.
  let padKey = ''
  const syncPadVisibility = () => {
    const key = showPads + controls.slots.join() + saved.players
    if (key === padKey) return
    padKey = key
    const els = [...$('#pads').children] as HTMLElement[]
    let visible = 0
    els.forEach((el, i) => { el.hidden = controls.slots[i] != null; if (!el.hidden) visible++ })
    $('#pads').style.setProperty('--np', String(Math.max(1, visible)))
    $('#pads').hidden = !showPads || visible === 0
    requestAnimationFrame(() => renderer.resize())
  }
  const buildPads = () => {
    padKey = ''
    const box = $('#pads')
    box.innerHTML = ''
    box.hidden = !showPads
    box.style.setProperty('--np', String(saved.players))
    $('#bPad').setAttribute('aria-pressed', String(showPads))
    for (let i = 0; i < saved.players; i++) {
      const c = PLAYER_COLORS[i]
      const el = document.createElement('div')
      el.className = 'pad'
      el.style.borderColor = c
      el.style.background = c + '1f'
      el.innerHTML = `<span class="lab" style="color:${c}">P${i + 1}</span><div class="joy"><div class="tip"><span>${matchMedia('(pointer: coarse)').matches ? `<b style="color:${c}">วางนิ้วแล้วลาก</b>เพื่อเดิน` : `<b style="color:${c}">คลิกเมาส์ค้างแล้วลาก</b>ไปทางที่จะเดิน · ปล่อย = หยุด`}</span></div><div class="base" hidden></div><div class="knob" hidden style="background:${c}"></div></div><button class="act" style="background:${c}" aria-label="หยิบหรือวาง ผู้เล่น ${i + 1}">หยิบ<br>วาง</button>`
      box.appendChild(el)
      const joy = el.querySelector<HTMLElement>('.joy')!, base = el.querySelector<HTMLElement>('.base')!, knob = el.querySelector<HTMLElement>('.knob')!
      const tip = el.querySelector<HTMLElement>('.tip')!, act = el.querySelector<HTMLElement>('.act')!
      const pad = controls.pads[i]
      let pid: number | null = null, ox = 0, oy = 0
      const R = 50
      const pos = (e: PointerEvent) => { const r = joy.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
      joy.addEventListener('pointerdown', e => {
        audio.unlock()
        if (pid !== null) return
        pid = e.pointerId
        try { joy.setPointerCapture(pid) } catch { /* ignore */ }
        ;[ox, oy] = pos(e)
        base.style.left = knob.style.left = ox + 'px'
        base.style.top = knob.style.top = oy + 'px'
        base.hidden = knob.hidden = false
        tip.hidden = true
        e.preventDefault()
      })
      joy.addEventListener('pointermove', e => {
        if (e.pointerId !== pid) return
        const [x, y] = pos(e)
        let dx = x - ox, dy = y - oy
        const m = Math.hypot(dx, dy)
        if (m > R) { ox += dx - (dx / m) * R; oy += dy - (dy / m) * R; dx = (dx / m) * R; dy = (dy / m) * R; base.style.left = ox + 'px'; base.style.top = oy + 'px' }
        knob.style.left = ox + dx + 'px'
        knob.style.top = oy + dy + 'px'
        // Gentle curve: 12% dead zone, small drags walk slowly, full speed at 80% of the ring.
        const v = Math.hypot(dx, dy) / R
        const k = v < 0.12 ? 0 : Math.min(1, (v - 0.12) / 0.68) / (v || 1)
        pad.jx = (dx / R) * k
        pad.jy = (dy / R) * k
      })
      const end = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = null; pad.jx = pad.jy = 0; base.hidden = knob.hidden = true; tip.hidden = false }
      joy.addEventListener('pointerup', end)
      joy.addEventListener('pointercancel', end)
      act.addEventListener('pointerdown', e => {
        audio.unlock(); e.preventDefault(); pad.btn++; act.classList.add('down')
        try { act.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      })
      const up = () => { pad.btn = Math.max(0, pad.btn - 1); if (!pad.btn) act.classList.remove('down') }
      act.addEventListener('pointerup', up)
      act.addEventListener('pointercancel', up)
    }
    requestAnimationFrame(() => renderer.resize())
  }
  document.addEventListener('gesturestart', e => e.preventDefault())

  // ---------- screens ----------
  const hideAll = () => { for (const id of ['#menu', '#over', '#paused', '#boot']) $(id).hidden = true }
  let wake: WakeLockSentinel | null = null
  const requestWake = async () => {
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null }) } } catch { /* ignore */ }
  }
  const startGame = () => {
    audio.unlock()
    audio.play('ui')
    game.applySettings(settings())
    game.start()
    loop.resetAccumulator()
    buildHud()
    hideAll()
    void requestWake()
  }
  const toMenu = () => {
    game.applySettings(settings())
    buildHud()
    hideAll()
    $('#menu').hidden = false
  }
  const togglePause = () => {
    if (sim.state === 'play' || sim.state === 'count') { sim.togglePause(); $('#paused').hidden = false }
    else if (sim.state === 'pause') resume()
  }
  const resume = () => { sim.resume(); $('#paused').hidden = true; loop.resetAccumulator() }
  const showResults = () => {
    const N = sim.settings.pallets
    const act = rank(sim.players)
    const medal = ['#e0a800', '#9aa5ab', '#c87533', '#5b6c72']
    $('#ovTitle').textContent = act.some(p => p.finished) ? 'ภารกิจสำเร็จ!' : 'หมดเวลา!'
    $('#resList').innerHTML = act.map((p, i) => {
      const stars = starsOf(p)
      return `<div class="rr" style="border-color:${PLAYER_COLORS[p.id]}"><div class="rk" style="color:${medal[i]}">${i + 1}</div>
        <div class="nm" style="color:${PLAYER_COLORS[p.id]}">ผู้เล่น ${p.id + 1} · ${PLAYER_NAMES[p.id]}<div class="dt">${p.finished ? 'โหลดครบทุกพาเลท' : 'ทำถึงขั้น ' + p.stage + ' ' + STAGE_NAMES[p.stage - 1]} · ชน ${p.bumps} ครั้ง</div><div class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div></div>
        <div class="tm">${p.finished ? fmt(p.finishTime + p.penalty) : p.loaded + '/' + N + ' ตู้'}<div class="dt">${p.finished ? (p.penalty ? 'รวมโทษ +' + p.penalty + ' วิ' : 'ไม่โดนโทษเลย') : 'ยังไม่ครบ · คืบหน้า ' + scoreOf(p)}</div></div></div>`
    }).join('')
    window.setTimeout(() => { if (sim.state === 'over') $('#over').hidden = false }, 1000)
  }
  game.onEnd = showResults

  const syncChips = () => document.querySelectorAll<HTMLElement>('.chips').forEach(g => g.querySelectorAll<HTMLElement>('.chip').forEach(b =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.v) === saved[g.dataset.k as keyof Settings]))))
  document.querySelectorAll<HTMLElement>('.chips').forEach(g => g.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.chip')
    if (!b) return
    audio.unlock(); audio.play('ui')
    saved[g.dataset.k as keyof Settings] = Number(b.dataset.v)
    syncChips()
    save()
    game.applySettings(settings())
    buildHud()
    buildPads()
  }))
  $('#bStart').onclick = startGame
  $('#bAgain').onclick = startGame
  $('#bRestart').onclick = startGame
  $('#bMenu').onclick = toMenu
  $('#bQuit').onclick = toMenu
  $('#bPause').onclick = togglePause
  $('#bResume').onclick = resume
  game.follow = saved.follow ?? true
  $('#bCam').setAttribute('aria-pressed', String(game.follow))
  $('#bCam').onclick = () => { game.follow = !game.follow; saved.follow = game.follow; save(); $('#bCam').setAttribute('aria-pressed', String(game.follow)); audio.play('ui') }
  $('#bPad').onclick = () => { showPads = !showPads; saved.pads = showPads; save(); $('#pads').hidden = !showPads; $('#bPad').setAttribute('aria-pressed', String(showPads)); requestAnimationFrame(() => renderer.resize()) }
  const syncMute = () => $('#bMute').setAttribute('aria-pressed', String(!audio.muted))
  $('#bMute').onclick = () => { audio.muted = !audio.muted; saved.muted = audio.muted; save(); syncMute() }
  $('#bFull').onclick = () => {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) (document.exitFullscreen ? document.exitFullscreen() : doc.webkitExitFullscreen?.())
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
      else el.webkitRequestFullscreen?.()
    } catch { /* ignore */ }
    window.setTimeout(() => renderer.resize(), 300)
  }
  addEventListener('keydown', e => {
    if (e.code === 'Enter' && ((sim.state === 'menu' && !$('#menu').hidden) || (sim.state === 'over' && !$('#over').hidden))) { e.preventDefault(); startGame() }
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause()
  })
  controls.onMenuButton = () => {
    if (sim.state === 'menu' && !$('#menu').hidden) startGame()
    else if (sim.state === 'over' && !$('#over').hidden) startGame()
    else if (sim.state === 'pause') resume()
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && (sim.state === 'play' || sim.state === 'count')) togglePause() })
  addEventListener('resize', () => renderer.resize())

  // ---------- joystick join panel ----------
  const joins = $('#joins')
  joins.innerHTML = PLAYER_COLORS.map((c, i) => `<div class="join" style="--pc:${c}"><b>${i + 1} · ${PLAYER_NAMES[i]}</b><span>รอกดปุ่ม…</span></div>`).join('')
  const joinEls = [...joins.querySelectorAll<HTMLElement>('.join')]
  let padCount = 0
  let joinKey = ''
  const syncJoins = () => {
    const now = performance.now()
    const key = padCount + '|' + controls.slots.join() + controls.activeAt.map(t => (now - t < 250 ? 1 : 0)).join('')
    if (key === joinKey) return
    joinKey = key
    joinEls.forEach((el, i) => {
      const on = controls.slots[i] !== null
      el.classList.toggle('on', on)
      el.classList.toggle('flash', on && now - controls.activeAt[i] < 250)
      el.querySelector('span')!.textContent = on ? '🎮 จอยพร้อมแล้ว' : (padCount > 0 ? 'กดปุ่มบนจอยเพื่อรับสีนี้' : '👆 ใช้นิ้ว/เมาส์ที่แป้นใต้จอ')
    })
    const bound = controls.slots.filter(s => s !== null).length
    $('#joyStatus').innerHTML = padCount === 0
      ? '<b>ยังไม่ได้ต่อจอย — เล่นได้เลย</b> ใช้นิ้ว (iPad) หรือเมาส์ (คอม) ลากที่แป้นบังคับใต้จอ'
      : `<b>พบจอย ${padCount} อัน</b> · ผูกแล้ว ${bound} อัน — ให้น้องแต่ละคน<b>กดปุ่มใดก็ได้บนจอยของตัวเอง</b> จอยจะได้สีตามลำดับที่กด คนที่ไม่มีจอยใช้แป้นบนจอได้`
    $('#bClearJoy').hidden = bound === 0
  }
  controls.onJoin = player => {
    audio.unlock(); audio.play('stage')
    // Binding a joystick to colour N guarantees at least N players; it never lowers the chosen count.
    if (sim.state === 'menu' && player + 1 > saved.players) {
      saved.players = player + 1
      syncChips(); save(); game.applySettings(settings()); buildHud(); buildPads()
    }
  }
  $('#bClearJoy').onclick = () => { controls.clearSlots(); audio.play('ui') }

  syncChips()
  syncMute()
  buildHud()
  buildPads()
  const loop = new GameLoop({
    step: dt => game.step(dt),
    render: (alpha, frame) => {
      controls.joinEnabled = sim.state === 'menu' && !$('#menu').hidden
      const n = controls.pollMenu()
      padCount = n
      syncPadVisibility()
      if (!$('#menu').hidden) syncJoins()
      const info = n ? ` · ต่อจอยแล้ว ${n} อัน` : ''
      const el = $('#padInfo')
      if (el.textContent !== info) el.textContent = info
      game.render(frame, alpha)
      updateHud()
    },
  })
  loop.start()
  hideAll()
  $('#menu').hidden = false
  // Debug/test hook (read-only use): smoke tests inspect state through it.
  ;(window as unknown as { __game: unknown }).__game = { game, sim, controls }
}

boot().catch(err => {
  console.error(err)
  const el = $('#stage')
  el.insertAdjacentHTML('beforeend', `<div class="fatal">โหลดเกมไม่สำเร็จ ลองเชื่อมต่ออินเทอร์เน็ตแล้วเปิดใหม่อีกครั้ง<br><small>${String((err as Error)?.message ?? err).replace(/[<>&]/g, '')}</small></div>`)
  $('#boot').hidden = true
})
