/**
 * The menu's terror bed: what the night sounds like before you dare press PLAY.
 *
 * All synthesised — the whole game's audio is oscillators and noise, and the menu keeps
 * that rule: nothing to download, nothing to license, nothing added to the boot budget
 * beyond this code. The register is the game's own: felt more than heard. A low detuned
 * drone, breathing wind, a slow heartbeat that never quite lets you relax, a distant
 * groan now and then — and thunder when the backdrop's lightning strikes (the preview
 * loop calls menuThunder on the shared schedule).
 *
 * Browsers gate audio behind a user gesture, so armMenuAudio waits for the first
 * pointerdown/keydown anywhere. stopMenuAudio hands the ears over to the game.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let heartTimer: ReturnType<typeof setInterval> | undefined
let groanTimer: ReturnType<typeof setTimeout> | undefined
let stopped = false

const begin = (): void => {
  if (ctx || stopped) return
  try {
    const Ctx = globalThis.AudioContext
    if (!Ctx) return
    ctx = new Ctx()
    void ctx.resume()

    master = ctx.createGain()
    master.gain.value = 0.0001
    master.connect(ctx.destination)
    // Ease the night in over three seconds — it should be there before it is noticed.
    master.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 3)

    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    // The drone: two sines a hair apart, beating slowly. The dread floor.
    for (const f of [42, 42.6]) {
      const osc = ctx.createOscillator()
      osc.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = 0.016
      osc.connect(g)
      g.connect(master)
      osc.start()
    }

    // The wind: filtered noise, breathing on a slow LFO.
    const wind = ctx.createBufferSource()
    wind.buffer = noise
    wind.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 220
    const wg = ctx.createGain()
    wg.gain.value = 0.035
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.05
    const lg = ctx.createGain()
    lg.gain.value = 0.02
    lfo.connect(lg)
    lg.connect(wg.gain)
    wind.connect(lp)
    lp.connect(wg)
    wg.connect(master)
    wind.start()
    lfo.start()

    // The heartbeat: a slow lub-dub, the game's scare signature made ambient.
    let dub = false
    heartTimer = setInterval(() => {
      if (!ctx || !master || ctx.state !== 'running') return
      const t = ctx.currentTime
      const osc = ctx.createOscillator()
      osc.frequency.setValueAtTime(58, t)
      osc.frequency.exponentialRampToValueAtTime(36, t + 0.1)
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, t)
      env.gain.exponentialRampToValueAtTime(dub ? 0.14 : 0.2, t + 0.015)
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.connect(env)
      env.connect(master)
      osc.start(t)
      osc.stop(t + 0.2)
      setTimeout(() => env.disconnect(), 300)
      dub = !dub
    }, 640)

    // The groan: something settles out there in the dark, every so often.
    const groan = (): void => {
      groanTimer = setTimeout(groan, 9000 + Math.random() * 11000)
      if (!ctx || !master || ctx.state !== 'running') return
      const t = ctx.currentTime
      for (const detune of [0, 6]) {
        const osc = ctx.createOscillator()
        osc.detune.value = detune
        osc.frequency.setValueAtTime(60 + Math.random() * 8, t)
        osc.frequency.exponentialRampToValueAtTime(41, t + 1.4)
        const env = ctx.createGain()
        env.gain.setValueAtTime(0.0001, t)
        env.gain.exponentialRampToValueAtTime(0.045, t + 0.4)
        env.gain.exponentialRampToValueAtTime(0.0001, t + 1.6)
        osc.connect(env)
        env.connect(master)
        osc.start(t)
        osc.stop(t + 1.7)
        setTimeout(() => env.disconnect(), 1900)
      }
    }
    groanTimer = setTimeout(groan, 5000)

    // Hidden tab: hold your breath.
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
  env.gain.exponentialRampToValueAtTime(0.16, t + 0.06)
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
  sg.gain.exponentialRampToValueAtTime(0.09, t + 0.05)
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

/** The game is starting: fade out fast and free the hardware for the game's own engine. */
export const stopMenuAudio = (): void => {
  stopped = true
  clearInterval(heartTimer)
  clearTimeout(groanTimer)
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
