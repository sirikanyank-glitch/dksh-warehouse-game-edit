import { describe, expect, it } from 'vitest'
import { BOX_PER, LVY, PSPOT, RK, bayX, slotPos } from '../src/game/layout'
import { Sim, rank, starsOf, type Player } from '../src/game/sim'

const idle = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, a: false }))
function playing(players = 1, pallets = 3): Sim {
  const sim = new Sim({ players, pallets, minutes: 5 })
  sim.start()
  sim.countT = 0.5
  sim.step(1 / 60, idle)
  expect(sim.state).toBe('play')
  return sim
}
/** Teleport so the player's front point is at (x,z) facing +z or -z. */
function at(p: Player, x: number, z: number, facing: 1 | -1, fd: number) {
  p.ang = facing === 1 ? 0 : Math.PI
  p.x = x; p.z = z - facing * fd; p.vx = p.vz = 0
}
const tick = (sim: Sim) => sim.step(1 / 60, idle)

describe('warehouse rules', () => {
  it('runs all five stages and finishes with the time + penalty result', () => {
    const sim = playing(1, 3)
    const p = sim.players[0]
    for (let k = 0; k < 3; k++) {
      for (let b = 0; b < BOX_PER; b++) {
        p.x = 0; p.z = -12.3; tick(sim)
        expect(p.carry).toBe('box')
        p.x = PSPOT.x; p.z = PSPOT.z; tick(sim)
      }
      expect(p.stage).toBe(2)
      expect(p.mode).toBe('jack')
      const s = slotPos(2, k)
      at(p, s.x, s.z, 1, 1.0); tick(sim)
    }
    expect(p.stage).toBe(3)
    expect(p.mode).toBe('fork')
    for (let k = 0; k < 3; k++) {
      const s = slotPos(2, p.s2.findIndex(v => v >= 0))
      at(p, s.x, s.z, 1, 1.35); tick(sim)
      expect(typeof p.carry).toBe('number')
      const c = p.rt[p.stored]
      p.forkY = LVY[c >= 5 ? 1 : 0]
      at(p, bayX(c % 5), RK.z1 + 0.1, -1, 1.35)
      sim.interact(p, false)
    }
    expect(p.stage).toBe(4)
    for (let k = 0; k < 3; k++) {
      const c = p.orders[p.picked]
      p.forkY = LVY[c >= 5 ? 1 : 0]
      at(p, bayX(c % 5), RK.z1 + 0.1, -1, 1.35)
      sim.interact(p, false)
      expect(typeof p.carry).toBe('number')
      const s = slotPos(4, p.picked)
      at(p, s.x, s.z, 1, 1.35); p.forkY = 0.3
      sim.interact(p, false)
    }
    expect(p.stage).toBe(5)
    p.penalty = 6
    for (let k = 0; k < 3; k++) {
      const s = slotPos(4, p.s4.findIndex(v => v >= 0))
      at(p, s.x, s.z, 1, 1.35); sim.interact(p, false)
      at(p, 0, 12.6, 1, 1.35); sim.interact(p, false)
    }
    expect(p.finished).toBe(true)
    expect(p.place).toBe(1)
    expect(starsOf(p)).toBe(2)
    expect(p.pallets.every(l => l.at === 'floor' && l.z > 13)).toBe(true)
  })

  it('pallets keep their four cartons through every move', () => {
    const sim = playing(1, 3)
    const p = sim.players[0]
    for (let b = 0; b < BOX_PER; b++) { p.x = 0; p.z = -12.3; tick(sim); p.x = PSPOT.x; p.z = PSPOT.z; tick(sim) }
    expect(p.pallets[0]).toEqual({ at: 'jack', boxes: 4 })
  })

  it('charges 3 s for a fast vehicle bump into the rack, not for walking', () => {
    const sim = playing(1, 3)
    const p = sim.players[0]
    p.z = RK.z1 + 0.6; p.x = 0; p.vz = -4; p.vx = 0
    sim.step(1 / 60, [{ x: 0, y: -1, a: false }, ...idle.slice(1)])
    expect(p.penalty).toBe(0)
    p.mode = 'fork'
    p.z = RK.z1 + 0.52; p.vz = -5
    sim.step(1 / 60, [{ x: 0, y: -1, a: false }, ...idle.slice(1)])
    expect(p.penalty).toBe(3)
    expect(p.bumps).toBe(1)
  })

  it('ranks finishers by time + penalty, then progress, then fewer penalties', () => {
    const sim = playing(4, 3)
    const [a, b, c, d] = sim.players
    a.finished = true; a.finishTime = 100; a.penalty = 9
    b.finished = true; b.finishTime = 105; b.penalty = 0
    c.built = 3; c.stored = 1; c.penalty = 3
    d.built = 3; d.stored = 1; d.penalty = 0
    expect(rank(sim.players).map(p => p.id)).toEqual([1, 0, 3, 2])
  })

  it('ends when time runs out and pauses freeze the clock', () => {
    const sim = playing(2, 3)
    sim.togglePause()
    const t = sim.timeLeft
    sim.step(1, idle)
    expect(sim.timeLeft).toBe(t)
    sim.resume()
    sim.timeLeft = 0.01
    tick(sim)
    expect(sim.state).toBe('over')
  })

  it('manual action widens the pickup/drop reach', () => {
    const sim = playing(1, 3)
    const p = sim.players[0]
    p.x = 0; p.z = -11.5 + 0.5; tick(sim)
    expect(p.carry).toBe(null)
    sim.interact(p, true)
    expect(p.carry).toBe('box')
  })
})
