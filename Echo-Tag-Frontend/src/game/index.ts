import {
  BG_COLOR,
  ECHO_BODIES_PER_PLAYER,
  MAX_PLAYERS,
  RoundPhase,
  addPlayer,
  createWorld,
  encodeInput,
  enterPhase,
  stepWorld,
  type World,
} from '@echo-tag/shared'
import { WebGLRenderer } from 'pixi.js'
import { createCamera, fitCamera, wantsRotate } from './engine/camera.ts'
import { createLayers, layoutLayers } from './engine/layers.ts'
import { advance, createTicker } from './engine/ticker.ts'
import { glowTexture, squareTexture } from './engine/textures.ts'
import { createKeyboard } from './input/keyboard.ts'
import { renderEchoes } from './render/echoRenderer.ts'
import { renderFx } from './render/fx.ts'
import { createAnimState, onTagged, renderPlayers } from './render/playerRenderer.ts'
import { BODY, ECHO } from './render/templates.ts'

/**
 * Phase 2: the arena, rendered and playable locally.
 *
 * The local player is slot 0 on the keyboard. The other eleven are driven by a deterministic
 * synthetic input pattern — *not* AI, which is Phase 6. They exist so the renderer can be
 * judged at full density: twelve avatars and 180 solid echo bodies is the load that matters,
 * and it is the load Phase 2's exit gate is written against.
 *
 * Phase 4 replaces the local `World` with a server-authoritative one. Nothing in the render
 * path changes when that happens — it reads a `World`, and does not care who advanced it.
 *
 * Two decisions in here are permanent:
 *   1. `WebGLRenderer` is constructed directly. Going through `Application` or
 *      `autoDetectRenderer` pulls the WebGPU adapter and the `Assets` loader into the
 *      bundle; there is no flag that removes them afterwards.
 *   2. Every texture is generated at runtime, so the game fetches no assets at all.
 */

export interface GameHandle {
  destroy(): void
}

export const startGame = async (canvas: HTMLCanvasElement): Promise<GameHandle> => {
  const renderer = new WebGLRenderer()
  await renderer.init({
    canvas,
    width: canvas.width,
    height: canvas.height,
    background: BG_COLOR,
    antialias: false, // flat colour on flat colour; AA costs fill rate for nothing
    resolution: 1, // the boot chunk already sized the canvas in device pixels
    autoDensity: false,
    powerPreference: 'high-performance',
    // No `preference: 'webgl'` — that belongs to `autoDetectRenderer`, which is precisely
    // what we are avoiding. Naming WebGLRenderer keeps WebGPU out of the bundle.
  })

  const layers = createLayers(squareTexture(), glowTexture())
  const cam = createCamera()
  const ticker = createTicker()
  const anim = createAnimState()
  const keyboard = createKeyboard()

  // ── World ──
  const world: World = createWorld(0xec07a6)
  for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(world, i !== 0)
  enterPhase(world, RoundPhase.Countdown)

  const inputs = new Uint8Array(MAX_PLAYERS)

  // Previous-tick positions, for render interpolation. Allocated once.
  const prevX = new Float32Array(MAX_PLAYERS)
  const prevY = new Float32Array(MAX_PLAYERS)
  const bodyCount = MAX_PLAYERS * ECHO_BODIES_PER_PLAYER
  const prevBodyX = new Float32Array(bodyCount)
  const prevBodyY = new Float32Array(bodyCount)
  prevX.set(world.x)
  prevY.set(world.y)
  prevBodyX.set(world.bodyX)
  prevBodyY.set(world.bodyY)

  // ── Layout ──
  let viewW = canvas.width
  let viewH = canvas.height

  const relayout = (): void => {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    viewW = Math.round(globalThis.innerWidth * dpr)
    viewH = Math.round(globalThis.innerHeight * dpr)
    if (canvas.width !== viewW || canvas.height !== viewH) {
      canvas.width = viewW
      canvas.height = viewH
    }
    renderer.resize(viewW, viewH)
    fitCamera(cam, world.arenaW, world.arenaH, viewW, viewH)
    layoutLayers(layers, cam)
    document.documentElement.dataset.rotateHint = wantsRotate(cam, viewW, viewH) ? '1' : '0'
  }
  relayout()
  addEventListener('resize', relayout, { passive: true })

  // ── Simulation step ──
  // Declared outside the frame callback so it is a stable function reference rather than a
  // closure allocated every frame.
  let simTick = 0
  const step = (): void => {
    prevX.set(world.x)
    prevY.set(world.y)
    prevBodyX.set(world.bodyX)
    prevBodyY.set(world.bodyY)

    // Slot 0 is the player. The rest orbit and periodically reverse, which is what actually
    // stresses the renderer: direction changes produce dense, self-intersecting trails.
    inputs[0] = keyboard.packed
    for (let s = 1; s < MAX_PLAYERS; s++) {
      const phase = s * 0.7 + simTick * 0.06
      const flip = (simTick + s * 17) % 71 < 35 ? 1 : -1
      inputs[s] = encodeInput(Math.cos(phase) * flip, Math.sin(phase * 1.3) * flip)
    }

    const ev = stepWorld(world, inputs)
    if (ev.tagCount > 0) onTagged(anim, ev.tagTo, performance.now())
    if (world.phase === RoundPhase.Leaderboard) enterPhase(world, RoundPhase.Countdown)
    simTick++
  }

  // ── Frame loop ──
  let raf = 0
  let last = 0
  let frames = 0

  const frame = (now: number): void => {
    // The first frame's delta spans renderer init and first shader compile — hundreds of
    // milliseconds of work that did not happen "during" gameplay. Feeding it to the
    // accumulator would ask the sim to catch up on time that never elapsed for the player,
    // so the first frame only establishes the clock.
    if (frames === 0) {
      last = now
      frames = 1
      raf = requestAnimationFrame(frame)
      return
    }

    const dt = now - last
    last = now
    frames++

    advance(ticker, dt, step)

    const a = ticker.alpha
    renderEchoes(layers.echoes, world, prevBodyX, prevBodyY, a, cam)
    renderFx(layers.fx, world, prevX, prevY, a, cam, now)
    renderPlayers(layers.bodies, world, prevX, prevY, a, cam, anim, now)

    renderer.render(layers.stage)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  // ── Signals the headless check reads ──
  const root = document.documentElement
  root.dataset.game = 'running'
  root.dataset.particles = String(MAX_PLAYERS * BODY.count + bodyCount * ECHO.count)
  root.dataset.bodySquares = String(BODY.count)
  Object.defineProperty(globalThis, '__echoTag', {
    configurable: true,
    get: () => ({
      frames,
      ticks: ticker.ticks,
      dropped: ticker.dropped,
      phase: world.phase,
      clockMs: world.clockMs,
      itSlot: world.itSlot,
      liveEchoBodies: world.bodyLive.reduce((s: number, v: number) => s + v, 0),
      arena: [world.arenaW, world.arenaH],
      camScale: cam.scale,
    }),
  })

  return {
    destroy(): void {
      cancelAnimationFrame(raf)
      removeEventListener('resize', relayout)
      keyboard.destroy()
      renderer.destroy()
      delete root.dataset.game
    },
  }
}
