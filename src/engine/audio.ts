/** Synthesized SFX (ported from the original game) with a master mute. No audio files. */
export type Sfx = 'pick' | 'place' | 'bump' | 'tick' | 'go' | 'stage' | 'win' | 'end' | 'ui'

export class Audio {
  private ctx?: AudioContext
  muted = false

  private ac(): AudioContext | undefined {
    if (!this.ctx) {
      try { this.ctx = new AudioContext() } catch { return undefined }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** Call from a user gesture so iOS allows sound. */
  unlock(): void { this.ac() }

  private tone(f: number, d: number, type: OscillatorType = 'sine', v = 0.12, when = 0, slide = 0): void {
    if (this.muted) return
    const a = this.ac()
    if (!a || a.state !== 'running') return
    const t = a.currentTime + when
    const o = a.createOscillator(), g = a.createGain()
    o.type = type
    o.frequency.setValueAtTime(f, t)
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d)
    g.gain.setValueAtTime(v, t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + d)
    o.connect(g).connect(a.destination)
    o.start(t)
    o.stop(t + d + 0.03)
  }

  play(name: Sfx): void {
    switch (name) {
      case 'pick': this.tone(480, 0.1, 'square', 0.06, 0, 760); break
      case 'place': this.tone(660, 0.08, 'triangle', 0.12); this.tone(990, 0.12, 'triangle', 0.1, 0.07); break
      case 'bump': this.tone(150, 0.28, 'sawtooth', 0.12, 0, 60); break
      case 'tick': this.tone(880, 0.09, 'sine', 0.14); break
      case 'go': this.tone(1320, 0.35, 'triangle', 0.15); break
      case 'stage': [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.12, i * 0.08)); break
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.14, i * 0.1)); break
      case 'end': [784, 659, 523, 392].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, i * 0.12)); break
      case 'ui': this.tone(660, 0.06, 'triangle', 0.1); break
    }
  }
}
