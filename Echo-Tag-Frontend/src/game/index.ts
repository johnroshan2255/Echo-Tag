import { ARENA_BASE_H, ARENA_BASE_W, BG_COLOR, PLAYER_COLORS, SQUARE_SIZE } from '@echo-tag/shared/constants'
import { Container, Particle, ParticleContainer, Texture, WebGLRenderer } from 'pixi.js'
import { squareTexture } from './engine/textures.ts'

/**
 * PHASE 2 STUB.
 *
 * This is not the game. It is the smallest thing that proves the whole rendering pipeline
 * is wired: the engine chunk splits and lazy-loads, a WebGL2 context comes up, the runtime
 * square texture generates, and a `ParticleContainer` batches and animates thousands of
 * particles. `tools/check/browser-check.ts` asserts all of that in headless Chrome, so
 * Phase 2 starts against a green baseline instead of a blank page.
 *
 * Phase 2 replaces the body of `startGame` with the real arena (templates, per-player
 * particle slices, echo silhouettes, camera, ticker) — but keeps this file's two
 * load-bearing decisions:
 *
 *   1. `WebGLRenderer` is constructed directly rather than via `new Application()`, which
 *      would drag the WebGPU adapter and the `Assets` loader into the bundle.
 *   2. Textures are generated at runtime. The game fetches no image, font or audio asset.
 */

/** 12 mock players x 180 squares — the same particle budget the real arena will carry. */
const MOCK_PLAYERS = 12
const SQUARES = 180
const COUNT = MOCK_PLAYERS * SQUARES

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
    resolution: 1, // the canvas is already sized in device pixels by the boot chunk
    autoDensity: false,
    powerPreference: 'high-performance',
    // No `preference: 'webgl'` here — that option belongs to `autoDetectRenderer`, which
    // is precisely what we are avoiding. Naming WebGLRenderer directly is what keeps the
    // WebGPU adapter out of the bundle; there is no flag to set.
  })

  const stage = new Container()
  const texture: Texture = squareTexture(renderer)

  // Position and colour change every frame; geometry and UVs never do. Declaring that
  // lets Pixi skip re-uploading the static buffers.
  const particles = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: false, rotation: false, uvs: false, vertex: false },
  })
  stage.addChild(particles)

  const px = new Float32Array(COUNT)
  const py = new Float32Array(COUNT)
  const vx = new Float32Array(COUNT)
  const vy = new Float32Array(COUNT)
  const pool: Particle[] = []

  // Letterbox a 16:9 arena inside the viewport — the same framing the real camera uses,
  // so this baseline screenshot is comparable to Phase 2's output.
  const fit = Math.min(canvas.width / ARENA_BASE_W, canvas.height / ARENA_BASE_H)
  const arenaW = ARENA_BASE_W * fit
  const arenaH = ARENA_BASE_H * fit
  const originX = (canvas.width - arenaW) / 2
  const originY = (canvas.height - arenaH) / 2
  const square = Math.max(2, SQUARE_SIZE * fit)

  // One 13x14 block of squares per mock player, drifting as a unit — reads as twelve
  // avatars in an arena rather than as confetti.
  for (let n = 0; n < MOCK_PLAYERS; n++) {
    const a = (n / MOCK_PLAYERS) * Math.PI * 2
    const cx = originX + arenaW * (0.5 + Math.cos(a) * 0.32)
    const cy = originY + arenaH * (0.5 + Math.sin(a) * 0.32)
    const tint = PLAYER_COLORS[n % PLAYER_COLORS.length]!

    for (let j = 0; j < SQUARES; j++) {
      const i = n * SQUARES + j
      const col = j % 13
      const row = (j / 13) | 0
      px[i] = cx + (col - 6) * square
      py[i] = cy + (row - 7) * square
      vx[i] = Math.cos(a + Math.PI) * 60 * fit
      vy[i] = Math.sin(a + Math.PI) * 60 * fit

      const p = new Particle({
        texture,
        x: px[i],
        y: py[i],
        scaleX: square,
        scaleY: square,
        tint,
      })
      pool.push(p)
      particles.addParticle(p)
    }
  }

  let raf = 0
  let last = performance.now()
  let frames = 0

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    frames++

    // Bounce each block off the arena edges, moving the whole block together.
    for (let n = 0; n < MOCK_PLAYERS; n++) {
      const base = n * SQUARES
      let bounceX = false
      let bounceY = false
      for (let j = 0; j < SQUARES; j++) {
        const i = base + j
        const x = px[i]! + vx[i]! * dt
        const y = py[i]! + vy[i]! * dt
        if (x < originX || x > originX + arenaW) bounceX = true
        if (y < originY || y > originY + arenaH) bounceY = true
        px[i] = x
        py[i] = y
        const p = pool[i]!
        p.x = x
        p.y = y
      }
      if (bounceX) for (let j = 0; j < SQUARES; j++) vx[base + j] = -vx[base + j]!
      if (bounceY) for (let j = 0; j < SQUARES; j++) vy[base + j] = -vy[base + j]!
    }

    renderer.render(stage)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  // Signals for the headless smoke check.
  const root = document.documentElement
  root.dataset.game = 'running'
  root.dataset.particles = String(COUNT)
  Object.defineProperty(globalThis, '__echoTagFrames', { get: () => frames, configurable: true })

  return {
    destroy(): void {
      cancelAnimationFrame(raf)
      renderer.destroy()
      delete root.dataset.game
    },
  }
}
