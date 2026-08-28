/**
 * The audio engine: a Web Audio graph, entirely synthesised.
 *
 * Koira is "musically driven" — its story is carried by sound, not words — and that is the
 * model here: the soundscape IS the horror-and-cosy balance. Nothing is fetched: every
 * sound is an oscillator, a filter and an envelope, which keeps the zero-asset load budget
 * intact and makes every parameter tunable in code.
 *
 * Construction happens inside `startGame`, i.e. after the Play click, so the browser's
 * user-gesture autoplay policy is satisfied by design. Everything is guarded: if audio is
 * unavailable (headless CI, muted iframes), every call is a silent no-op and gameplay is
 * untouched.
 */

import humanMp3 from '../../../sounds/human.mp3'
import ghostMp3 from '../../../sounds/gost.mp3'
import batsMp3 from '../../../sounds/bats.mp3'
import doorMp3 from '../../../sounds/door-open-close.mp3'

export interface AudioEngine {
  ctx: AudioContext | null
  master: GainNode | null
  /** Master tone filter: wide open normally, clamped low while hiding in a wardrobe. */
  tone: BiquadFilterNode | null
  /** Shared noise buffer — one second of white noise, reused by every noise-based voice. */
  noise: AudioBuffer | null
  muted: boolean
  buffers: Map<string, AudioBuffer>
}

export const createAudioEngine = (): AudioEngine => {
  try {
    const Ctx = globalThis.AudioContext
    if (!Ctx) return { ctx: null, master: null, tone: null, noise: null, muted: true, buffers: new Map() }
    const ctx = new Ctx()

    const master = ctx.createGain()
    master.gain.value = 1.2
    // Master tone: everything routes through one lowpass so "inside a wardrobe" can muffle
    // the entire world with a single parameter ramp.
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 20_000
    // A gentle compressor keeps overlapping one-shots from ever spiking.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -22
    comp.ratio.value = 8
    master.connect(tone)
    tone.connect(comp)
    comp.connect(ctx.destination)

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    void ctx.resume()
    // The refresh-rejoin path starts the game with no user gesture, so the context comes
    // up suspended; the first press or tap unlocks it. One-shot listeners, self-removing.
    if (ctx.state === 'suspended') {
      const unlock = (): void => {
        void ctx.resume()
        removeEventListener('pointerdown', unlock)
        removeEventListener('keydown', unlock)
      }
      addEventListener('pointerdown', unlock)
      addEventListener('keydown', unlock)
    }
    const engine: AudioEngine = { ctx, master, tone, noise, muted: false, buffers: new Map() }

    const loadSound = async (name: string, url: string) => {
      try {
        const resp = await fetch(url)
        const arrayBuffer = await resp.arrayBuffer()
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
        engine.buffers.set(name, audioBuffer)
      } catch (e) {
        console.error('Failed to load sound', name, e)
      }
    }

    void loadSound('human', humanMp3)
    void loadSound('ghost', ghostMp3)
    void loadSound('bats', batsMp3)
    void loadSound('door', doorMp3)

    return engine
  } catch {
    // If AudioContext fails (e.g. headless tests), return a silent stub.
    return { ctx: null, master: null, tone: null, noise: null, muted: false, buffers: new Map() }
  }
}

export const setMuted = (a: AudioEngine, muted: boolean): void => {
  a.muted = muted
  if (a.master) a.master.gain.value = muted ? 0 : 1.2
}

/** Distance/pan helpers: world-space offsets to a listener-relative gain and pan. */
export const distanceGain = (dist: number, earshot: number): number => {
  if (dist >= earshot) return 0
  const t = 1 - dist / earshot
  return t * t // inverse-square-ish: near things much louder than far things
}

export const panFor = (dx: number): number => {
  const p = dx / 600
  return p < -1 ? -1 : p > 1 ? 1 : p
}

/** Muffles or clears the whole mix — the inside-a-wardrobe ear. */
export const setMuffled = (a: AudioEngine, muffled: boolean): void => {
  if (!a.ctx || !a.tone) return
  a.tone.frequency.setTargetAtTime(muffled ? 320 : 20_000, a.ctx.currentTime, 0.08)
}
