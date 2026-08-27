import { Container, Sprite, type Texture } from 'pixi.js'
import { TURN_GLOW_TINT } from '../theme.ts'

/**
 * The terror overlay: what BECOMING the ghost feels like from inside.
 *
 * While the metamorphosis runs (and for a beat after the crowning), the victim's own
 * screen judders and tears — horizontal glitch bars deal and re-deal across the view,
 * thicker and more frequent as the ghost takes hold. This is strictly first-person
 * feedback: it renders only on the client whose player is turning (`mySlot` gating in
 * game/index.ts), so in multiplayer everyone else sees the arena telegraphs (wreath,
 * halo, flicker) but only the victim's monitor shakes.
 *
 * Screen-space, in the overlay root — the camera never touches it. The world shake
 * itself is applied in game/index.ts as a post-applyCamera offset on worldRoot, for the
 * same reason: both are per-viewport effects, not world state.
 *
 * One pooled Container of sprites sharing the 8px square texture: one draw call while
 * active, zero when hidden, zero allocation per frame. Bars are re-dealt from a
 * deterministic hash of (bar, time-slice) — no RNG state, nothing to carry between
 * frames.
 */

export interface TerrorLayer {
  container: Container
  bars: Sprite[]
}

const BAR_COUNT = 18
/** Bars re-deal every N ms — fast enough to read as tearing, slow enough to see. */
const DEAL_MS = 85

export const createTerrorLayer = (square: Texture): TerrorLayer => {
  const container = new Container()
  container.visible = false
  const bars: Sprite[] = []
  for (let i = 0; i < BAR_COUNT; i++) {
    const s = new Sprite(square)
    s.anchor.set(0, 0.5)
    s.visible = false
    container.addChild(s)
    bars.push(s)
  }
  return { container, bars }
}

/** Cheap stateless hash to [0,1) — the classic sin-fract, good enough for glitch. */
const hash = (n: number): number => {
  const x = Math.sin(n) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Draws the tear bars at `intensity` (0 hides everything, 1 is the full crowning storm).
 * View dimensions are device pixels; bar sizes scale with the viewport.
 */
export const renderTerror = (
  layer: TerrorLayer,
  intensity: number,
  nowMs: number,
  viewW: number,
  viewH: number,
): void => {
  if (intensity <= 0) {
    layer.container.visible = false
    return
  }
  layer.container.visible = true

  const slice = Math.floor(nowMs / DEAL_MS)
  const shown = Math.max(3, Math.round(BAR_COUNT * intensity))

  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = layer.bars[i]!
    if (i >= shown) {
      bar.visible = false
      continue
    }
    const h1 = hash(i * 127.1 + slice * 311.7)
    const h2 = hash(i * 269.5 + slice * 183.3)
    const h3 = hash(i * 419.2 + slice * 371.9)
    // Bars blink in and out between deals — a storm of tears, never a static grille.
    if (h3 < 0.3) {
      bar.visible = false
      continue
    }
    bar.visible = true
    bar.y = h1 * viewH
    // Mostly hairlines, occasionally a thick slab (h2² skews thin).
    bar.height = (1.5 + h2 * h2 * 30) * (viewH / 900) * (0.4 + intensity)
    // Horizontal tear: the bar overshoots the view and sits slightly off-axis.
    bar.width = viewW * 1.12
    bar.x = (h2 - 0.5) * viewW * 0.08 * intensity
    bar.alpha = (0.3 + h3 * 0.55) * Math.min(1, 0.35 + intensity)
    // Almost all void-black; the odd one flashes the metamorphosis violet.
    bar.tint = h1 > 0.93 ? TURN_GLOW_TINT : 0x05030c
  }
}
