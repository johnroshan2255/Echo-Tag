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
  rate?: number
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
  click.stop(t + 0.1)
}

export const wardrobeOpen = (a: AudioEngine, p: Placed): void => {
  if (!a.ctx) return
  const buf = a.buffers.get('door')
  if (!buf) return
  const t = a.ctx.currentTime
  const out = bus(a, p, t + buf.duration + 0.1)
  if (!out) return

  const src = a.ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = 1.0
  src.connect(out)
  src.start(t)
}

export const wardrobeClose = (a: AudioEngine, p: Placed): void => {
  if (!a.ctx) return
  const buf = a.buffers.get('door')
  if (!buf) return
  const t = a.ctx.currentTime
  const out = bus(a, p, t + buf.duration + 0.1)
  if (!out) return

  const src = a.ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = 0.85
  src.connect(out)
  src.start(t)
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

/** A footstep tick. Now louder and more audible as requested. */
export const footstep = (a: AudioEngine, p: Placed): void => {
  if (!a.ctx) return
  const buf = a.buffers.get('human')
  if (!buf) return
  const t = a.ctx.currentTime
  
  // Cut off after 0.25s max to prevent overlapping tails
  const duration = Math.min(buf.duration, 0.25)
  const out = bus(a, p, t + duration)
  if (!out) return
  
  const src = a.ctx.createBufferSource()
  src.buffer = buf
  if (p.rate) src.playbackRate.value = p.rate
  
  const env = a.ctx.createGain()
  env.gain.setValueAtTime(1.0, t)
  env.gain.exponentialRampToValueAtTime(0.01, t + duration)
  
  src.connect(env)
  env.connect(out)
  src.start(t)
  src.stop(t + duration + 0.05)
}

/** A heavier, unsettling thud for the ghost's footstep. */
export const ghostFootstep = (a: AudioEngine, p: Placed): void => {
  if (!a.ctx) return
  const buf = a.buffers.get('ghost')
  if (!buf) return
  const t = a.ctx.currentTime
  
  const duration = Math.min(buf.duration, 0.35)
  const out = bus(a, p, t + duration)
  if (!out) return
  
  const src = a.ctx.createBufferSource()
  src.buffer = buf
  if (p.rate) src.playbackRate.value = p.rate
  
  const env = a.ctx.createGain()
  env.gain.setValueAtTime(1.0, t)
  env.gain.exponentialRampToValueAtTime(0.01, t + duration)
  
  src.connect(env)
  env.connect(out)
  src.start(t)
  src.stop(t + duration + 0.05)
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

/** A running ambient bed. stop() fades it out and releases every node it owns. */
export interface AmbientBed {
  stop(): void
}

const SILENT_BED: AmbientBed = { stop: () => {} }

/** Fade-out-and-release shared by both beds. */
const bedTeardown = (
  ctx: AudioContext,
  out: GainNode,
  sources: AudioScheduledSourceNode[],
  timer?: ReturnType<typeof setInterval>,
): AmbientBed => ({
  stop(): void {
    if (timer !== undefined) clearInterval(timer)
    out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25)
    setTimeout(() => {
      for (const s of sources) {
        try {
          s.stop()
          s.disconnect()
        } catch {
          /* already stopped */
        }
      }
      out.disconnect()
    }, 1400)
  },
})

/**
 * The night bed (manor, forest, cave): slow-breathing filtered wind and a very low drone.
 * This is the "scary" that is really cosiness with the lights down — constant, quiet,
 * and it makes the one-shots land against silence instead of nothing.
 */
export const startAmbientBed = (a: AudioEngine): AmbientBed => {
  if (!a.ctx || !a.master || !a.noise) return SILENT_BED
  const ctx = a.ctx
  const out = ctx.createGain()
  out.gain.value = 1
  out.connect(a.master)

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
  wg.connect(out)
  wind.start()
  lfo1.start()
  lfo2.start()

  const drone = ctx.createOscillator()
  drone.type = 'sine'
  drone.frequency.value = 48
  const dg = ctx.createGain()
  dg.gain.value = 0.022
  drone.connect(dg)
  dg.connect(out)
  drone.start()

  return bedTeardown(ctx, out, [wind, lfo1, lfo2, drone])
}

/**
 * The hive bed: the alien map gets MUSIC where the other worlds get weather. A deep
 * detuned drone, a slow minor chord pad drifting through a four-chord cycle, and every
 * other bar a theremin phrase — the wobbling glide that has meant "flying saucer" since
 * the fifties. All synthesised, all quiet; the melody is atmosphere, not soundtrack.
 */
export const startHiveBed = (a: AudioEngine): AmbientBed => {
  if (!a.ctx || !a.master || !a.noise) return SILENT_BED
  const ctx = a.ctx
  const out = ctx.createGain()
  out.gain.value = 1
  out.connect(a.master)

  // The floor: two sines a hair apart, beating slowly against each other.
  const droneA = ctx.createOscillator()
  droneA.type = 'sine'
  droneA.frequency.value = 55
  const droneB = ctx.createOscillator()
  droneB.type = 'sine'
  droneB.frequency.value = 55.4
  const dg = ctx.createGain()
  dg.gain.value = 0.016
  droneA.connect(dg)
  droneB.connect(dg)
  dg.connect(out)
  droneA.start()
  droneB.start()

  // Star shimmer: barely-there high noise, breathing on a very slow LFO.
  const shimmer = ctx.createBufferSource()
  shimmer.buffer = a.noise
  shimmer.loop = true
  const hf = ctx.createBiquadFilter()
  hf.type = 'highpass'
  hf.frequency.value = 6200
  const sg = ctx.createGain()
  sg.gain.value = 0.006
  const slfo = ctx.createOscillator()
  slfo.frequency.value = 0.043
  const slg = ctx.createGain()
  slg.gain.value = 0.004
  slfo.connect(slg)
  slg.connect(sg.gain)
  shimmer.connect(hf)
  hf.connect(sg)
  sg.connect(out)
  shimmer.start()
  slfo.start()

  // Am — F — Dm — Em, one chord per bar; the theremin sings over bars 1 and 3.
  const CHORDS: readonly (readonly number[])[] = [
    [110, 130.81, 164.81],
    [87.31, 110, 130.81],
    [73.42, 110, 146.83],
    [82.41, 98, 123.47],
  ]
  const PHRASES: readonly (readonly number[])[] = [
    [440, 523.25, 659.26, 587.33],
    [659.26, 587.33, 493.88, 440],
  ]
  const BAR_S = 7.5
  let bar = 0
  const playBar = (): void => {
    if (a.muted || ctx.state !== 'running') {
      bar = (bar + 1) % 4
      return
    }
    const t = ctx.currentTime + 0.05
    // The pad: three soft triangles swelling in and out over the bar.
    for (const freq of CHORDS[bar % 4]!) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, t)
      env.gain.exponentialRampToValueAtTime(0.013, t + 2.6)
      env.gain.setValueAtTime(0.013, t + BAR_S - 3)
      env.gain.exponentialRampToValueAtTime(0.0001, t + BAR_S + 0.4)
      osc.connect(env)
      env.connect(out)
      osc.start(t)
      osc.stop(t + BAR_S + 0.6)
      setTimeout(() => env.disconnect(), (BAR_S + 1) * 1000)
    }
    // The theremin: a vibrato sine gliding through a four-note phrase.
    if (bar % 2 === 0) {
      const phrase = PHRASES[(bar >> 1) % 2]!
      const voice = ctx.createOscillator()
      voice.type = 'sine'
      const vib = ctx.createOscillator()
      vib.frequency.value = 5.4
      const vibG = ctx.createGain()
      vibG.gain.value = 7
      vib.connect(vibG)
      vibG.connect(voice.frequency)
      voice.frequency.setValueAtTime(phrase[0]!, t)
      const noteS = 1.15
      phrase.forEach((f, i) => voice.frequency.exponentialRampToValueAtTime(f, t + 0.6 + i * noteS))
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, t)
      env.gain.exponentialRampToValueAtTime(0.028, t + 0.9)
      env.gain.setValueAtTime(0.028, t + 0.6 + phrase.length * noteS - 0.5)
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.6 + phrase.length * noteS + 0.8)
      voice.connect(env)
      env.connect(out)
      voice.start(t)
      voice.stop(t + 0.6 + phrase.length * noteS + 1)
      vib.start(t)
      vib.stop(t + 0.6 + phrase.length * noteS + 1)
      setTimeout(() => env.disconnect(), (0.6 + phrase.length * noteS + 1.2) * 1000)
    }
    bar = (bar + 1) % 4
  }
  playBar()
  const timer = setInterval(playBar, BAR_S * 1000)

  return bedTeardown(ctx, out, [droneA, droneB, shimmer, slfo], timer)
}

/**
 * The hive settling: where the manor groans, the hive answers with a distant signal — a
 * two-note descending theremin chirp, quiet and directionless. Information-free on
 * purpose, exactly like the groan it replaces.
 */
export const hiveSignal = (a: AudioEngine, pan: number): void => {
  if (!a.ctx || !a.master || a.muted) return
  const t = a.ctx.currentTime
  const out = bus(a, { gain: 0.2, pan }, t + 1.6)
  if (!out) return
  for (const [f0, f1, at] of [
    [880, 470, 0],
    [700, 392, 0.55],
  ] as const) {
    const osc = a.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f0, t + at)
    osc.frequency.exponentialRampToValueAtTime(f1, t + at + 0.5)
    const vib = a.ctx.createOscillator()
    vib.frequency.value = 6
    const vg = a.ctx.createGain()
    vg.gain.value = 9
    vib.connect(vg)
    vg.connect(osc.frequency)
    const env = a.ctx.createGain()
    env.gain.setValueAtTime(0.0001, t + at)
    env.gain.exponentialRampToValueAtTime(0.18, t + at + 0.08)
    env.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.6)
    osc.connect(env)
    env.connect(out)
    osc.start(t + at)
    osc.stop(t + at + 0.7)
    vib.start(t + at)
    vib.stop(t + at + 0.7)
  }
}

/** The UFO squadron passing overhead: a low tremolo engine hum panning across the sky. */
export const ufoPass = (a: AudioEngine, pan: number): void => {
  if (!a.ctx || !a.master || a.muted) return
  const ctx = a.ctx
  const t = ctx.currentTime
  const dur = 4.4

  const panner = ctx.createStereoPanner()
  panner.pan.setValueAtTime(-pan, t)
  panner.pan.linearRampToValueAtTime(pan, t + dur)

  const env = ctx.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(0.11, t + dur * 0.3)
  env.gain.setValueAtTime(0.11, t + dur * 0.7)
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  panner.connect(env)
  env.connect(a.master)

  // The engine: a dark filtered saw drifting down in pitch, throbbing at ~3.3Hz.
  const hum = ctx.createOscillator()
  hum.type = 'sawtooth'
  hum.frequency.setValueAtTime(96, t)
  hum.frequency.exponentialRampToValueAtTime(70, t + dur)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 320
  const trem = ctx.createOscillator()
  trem.frequency.value = 3.3
  const tg = ctx.createGain()
  tg.gain.value = 0.35
  const humG = ctx.createGain()
  humG.gain.value = 0.65
  trem.connect(tg)
  tg.connect(humG.gain)
  hum.connect(lp)
  lp.connect(humG)
  humG.connect(panner)
  hum.start(t)
  hum.stop(t + dur)
  trem.start(t)
  trem.stop(t + dur)

  setTimeout(() => {
    try {
      panner.disconnect()
      env.disconnect()
      humG.disconnect()
    } catch {
      /* already gone */
    }
  }, dur * 1000 + 100)
}

/** A bat flock just launched — wings, flying across the screen. */
export const batFlutter = (a: AudioEngine, pan: number): void => {
  if (!a.ctx || !a.master || a.muted) return
  const buf = a.buffers.get('bats')
  if (!buf) return
  const t = a.ctx.currentTime
  
  // The bat flock takes ~4.9s to cross the screen (2100 distance at 430 speed)
  const duration = Math.min(buf.duration, 5.0)
  
  const panner = a.ctx.createStereoPanner()
  // Fly across the screen by panning from the opposite side to the target side
  panner.pan.setValueAtTime(-pan, t)
  panner.pan.linearRampToValueAtTime(pan, t + duration)

  const env = a.ctx.createGain()
  // Fade in when they spawn, hold, then fade out as they hide
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(1.0, t + (duration * 0.2))
  env.gain.setValueAtTime(1.0, t + (duration * 0.8))
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  
  panner.connect(env)
  env.connect(a.master)

  const src = a.ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = 1.05 // Slightly frantic speed
  src.connect(panner)
  src.start(t)
  src.stop(t + duration)
  
  // Cleanup
  setTimeout(() => {
    try {
      src.disconnect()
      panner.disconnect()
      env.disconnect()
    } catch {}
  }, duration * 1000 + 100)
}

/**
 * The house settling: a low detuned groan from nowhere in particular, every half-minute or
 * so. Carries no information at all — it exists so the quiet is never quite trustworthy.
 */
export const nightGroan = (a: AudioEngine, pan: number): void => {
  if (!a.ctx || !a.master || a.muted) return
  const t = a.ctx.currentTime
  const out = bus(a, { gain: 0.32, pan }, t + 1.8)
  if (!out) return
  for (const [f0, f1, detune] of [
    [61, 43, 0],
    [61.7, 43.6, 5],
  ] as const) {
    const osc = a.ctx.createOscillator()
    osc.type = 'sine'
    osc.detune.value = detune
    osc.frequency.setValueAtTime(f0, t)
    osc.frequency.exponentialRampToValueAtTime(f1, t + 1.3)
    const env = a.ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(0.16, t + 0.35)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.5)
    osc.connect(env)
    env.connect(out)
    osc.start(t)
    osc.stop(t + 1.6)
  }
}
