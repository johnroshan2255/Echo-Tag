import type { AudioEngine } from './engine.ts'

/**
 * The instrument rack: one function per sound, all synthesised.
 *
 * Design line for every voice: felt more than heard. Master sits low, envelopes are soft,
 * and nothing here should make a player reach for the volume key — the scare register is
 * "old house at night", not "haunted house ride".
 */

interface Placed {
  gain: number
  pan: number
}

/** Small helper: a gain+panner chain that auto-disconnects when the voice ends. */
const bus = (a: AudioEngine, p: Placed, endTime: number): AudioNode | null => {
  if (!a.ctx || !a.master || a.muted || p.gain <= 0.001) return null
  const g = a.ctx.createGain()
  g.gain.value = p.gain
  const pan = a.ctx.createStereoPanner()
  pan.pan.value = p.pan
  g.connect(pan)
  pan.connect(a.master)
  setTimeout(() => g.disconnect(), (endTime - a.ctx.currentTime) * 1000 + 100)
  return g
}

/**
 * Door creak: a squeaky descending tone with stick-slip vibrato, over a hinge-noise bed.
 * The classic horror telegraph — but short and softened, per the design line.
 */
export const doorCreak = (a: AudioEngine, p: Placed): void => {
  if (!a.ctx || !a.noise) return
  const t = a.ctx.currentTime
  const out = bus(a, p, t + 0.7)
  if (!out) return

  const osc = a.ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(520, t)
  osc.frequency.exponentialRampToValueAtTime(310, t + 0.5)
  const vib = a.ctx.createOscillator()
  vib.frequency.value = 13
  const vibGain = a.ctx.createGain()
  vibGain.gain.value = 42 // stick-slip wobble
  vib.connect(vibGain)
  vibGain.connect(osc.frequency)

  const filt = a.ctx.createBiquadFilter()
  filt.type = 'bandpass'
  filt.frequency.value = 900
  filt.Q.value = 7

  const env = a.ctx.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(0.5, t + 0.06)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)

  osc.connect(filt)
  filt.connect(env)
  env.connect(out)
  osc.start(t)
  osc.stop(t + 0.6)
  vib.start(t)
  vib.stop(t + 0.6)
}

/** Door thud: the shut. A low knock with a felt-damped tail. */
export const doorThud = (a: AudioEngine, p: Placed): void => {
  if (!a.ctx || !a.noise) return
  const t = a.ctx.currentTime
  const out = bus(a, p, t + 0.3)
  if (!out) return

  const osc = a.ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(120, t)
  osc.frequency.exponentialRampToValueAtTime(52, t + 0.12)
  const env = a.ctx.createGain()
  env.gain.setValueAtTime(0.7, t)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
  osc.connect(env)
  env.connect(out)
  osc.start(t)
  osc.stop(t + 0.25)

  const click = a.ctx.createBufferSource()
  click.buffer = a.noise
  const cf = a.ctx.createBiquadFilter()
  cf.type = 'lowpass'
  cf.frequency.value = 700
  const cg = a.ctx.createGain()
  cg.gain.setValueAtTime(0.25, t)
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
  click.connect(cf)
  cf.connect(cg)
  cg.connect(out)
  click.start(t)
  click.stop(t + 0.08)
}

/** One heartbeat thump — the director calls this on its own accelerating schedule. */
export const heartThump = (a: AudioEngine, gain: number): void => {
  if (!a.ctx || !a.master || a.muted || gain <= 0.001) return
  const t = a.ctx.currentTime
  const osc = a.ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(64, t)
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.1)
  const env = a.ctx.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(gain, t + 0.015)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
  osc.connect(env)
  env.connect(a.master)
  osc.start(t)
  osc.stop(t + 0.2)
  setTimeout(() => env.disconnect(), 300)
}

/** A soft footstep tick. Others' steps are how you track what you cannot see. */
export const footstep = (a: AudioEngine, p: Placed): void => {
  if (!a.ctx || !a.noise) return
  const t = a.ctx.currentTime
  const out = bus(a, p, t + 0.1)
  if (!out) return
  const src = a.ctx.createBufferSource()
  src.buffer = a.noise
  src.playbackRate.value = 0.7 + Math.random() * 0.25
  const filt = a.ctx.createBiquadFilter()
  filt.type = 'bandpass'
  filt.frequency.value = 300 + Math.random() * 120
  filt.Q.value = 1.6
  const env = a.ctx.createGain()
  env.gain.setValueAtTime(0.5, t)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
  src.connect(filt)
  filt.connect(env)
  env.connect(out)
  src.start(t)
  src.stop(t + 0.09)
}

/** The tag: a two-note minor sting, louder when it involves you. */
export const tagSting = (a: AudioEngine, p: Placed): void => {
  if (!a.ctx) return
  const t = a.ctx.currentTime
  const out = bus(a, p, t + 0.8)
  if (!out) return
  for (const [freq, at, dur] of [
    [392, 0, 0.3],
    [311, 0.12, 0.5],
  ] as const) {
    const osc = a.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    const env = a.ctx.createGain()
    env.gain.setValueAtTime(0.0001, t + at)
    env.gain.exponentialRampToValueAtTime(0.55, t + at + 0.02)
    env.gain.exponentialRampToValueAtTime(0.0001, t + at + dur)
    osc.connect(env)
    env.connect(out)
    osc.start(t + at)
    osc.stop(t + at + dur + 0.05)
  }
}

/**
 * The ambient bed, started once: slow-breathing filtered wind and a very low drone.
 * This is the "scary" that is really cosiness with the lights down — constant, quiet,
 * and it makes the one-shots land against silence instead of nothing.
 */
export const startAmbientBed = (a: AudioEngine): void => {
  if (!a.ctx || !a.master || !a.noise) return
  const ctx = a.ctx

  const wind = ctx.createBufferSource()
  wind.buffer = a.noise
  wind.loop = true
  const wf = ctx.createBiquadFilter()
  wf.type = 'lowpass'
  wf.frequency.value = 210
  const wg = ctx.createGain()
  wg.gain.value = 0.05
  // The wind breathes: two slow LFOs on gain and filter cutoff.
  const lfo1 = ctx.createOscillator()
  lfo1.frequency.value = 0.031
  const l1g = ctx.createGain()
  l1g.gain.value = 0.02
  lfo1.connect(l1g)
  l1g.connect(wg.gain)
  const lfo2 = ctx.createOscillator()
  lfo2.frequency.value = 0.017
  const l2g = ctx.createGain()
  l2g.gain.value = 80
  lfo2.connect(l2g)
  l2g.connect(wf.frequency)

  wind.connect(wf)
  wf.connect(wg)
  wg.connect(a.master)
  wind.start()
  lfo1.start()
  lfo2.start()

  const drone = ctx.createOscillator()
  drone.type = 'sine'
  drone.frequency.value = 48
  const dg = ctx.createGain()
  dg.gain.value = 0.022
  drone.connect(dg)
  dg.connect(a.master)
  drone.start()
}
