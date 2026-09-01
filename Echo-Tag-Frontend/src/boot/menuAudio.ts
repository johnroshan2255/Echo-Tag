import { playMusic } from '../platform/music.ts'

/**
 * Menu audio: the music (platform/music.ts — a CC0 8-bit spooky loop) plus thunder that
 * answers the backdrop's lightning (the preview loop calls menuThunder on the shared
 * schedule). The thunder is synthesised right here — one noise roll and a sub-drop —
 * because a two-second rumble is cheaper as oscillators than as a download.
 *
 * Browsers gate audio behind a user gesture, so armMenuAudio waits for the first
 * pointerdown/keydown anywhere. stopMenuAudio hands the ears over to the game (the music
 * element itself lives on — the lobby keeps playing it; the game pauses it per phase).
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let stopped = false

const begin = (): void => {
  if (stopped) return
  playMusic()
  if (ctx) return
  try {
    const Ctx = globalThis.AudioContext
    if (!Ctx) return
    ctx = new Ctx()
    void ctx.resume()
    master = ctx.createGain()
    master.gain.value = 1
    master.connect(ctx.destination)
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    document.addEventListener('visibilitychange', onVisibility)
  } catch {
    /* no audio — the menu is still a menu */
  }
}

const onVisibility = (): void => {
  if (!ctx) return
  if (document.hidden) void ctx.suspend()
  else if (!stopped) void ctx.resume()
}

/** Thunder answering the backdrop's lightning: a low noise roll with a sub-drop under it. */
export const menuThunder = (): void => {
  if (!ctx || !master || ctx.state !== 'running') return
  const t = ctx.currentTime + 0.12 // light first, sound a beat later
  const roll = ctx.createBufferSource()
  roll.buffer = noise
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(340, t)
  lp.frequency.exponentialRampToValueAtTime(70, t + 1.8)
  const env = ctx.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(0.14, t + 0.06)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 2)
  roll.connect(lp)
  lp.connect(env)
  env.connect(master)
  roll.start(t)
  roll.stop(t + 2.1)

  const sub = ctx.createOscillator()
  sub.frequency.setValueAtTime(52, t)
  sub.frequency.exponentialRampToValueAtTime(30, t + 1.2)
  const sg = ctx.createGain()
  sg.gain.setValueAtTime(0.0001, t)
  sg.gain.exponentialRampToValueAtTime(0.08, t + 0.05)
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3)
  sub.connect(sg)
  sg.connect(master)
  sub.start(t)
  sub.stop(t + 1.4)
  setTimeout(() => {
    env.disconnect()
    sg.disconnect()
  }, 2300)
}

/** Wait for the first gesture (the autoplay gate), then let the night in. */
export const armMenuAudio = (): void => {
  const onGesture = (): void => {
    removeEventListener('pointerdown', onGesture)
    removeEventListener('keydown', onGesture)
    begin()
  }
  addEventListener('pointerdown', onGesture)
  addEventListener('keydown', onGesture)
}

/** The game is starting: retire the thunder; the music keeps going into the lobby. */
export const stopMenuAudio = (): void => {
  stopped = true
  document.removeEventListener('visibilitychange', onVisibility)
  if (ctx && master) {
    master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15)
    const dying = ctx
    setTimeout(() => void dying.close().catch(() => {}), 700)
  }
  ctx = null
  master = null
  noise = null
}
