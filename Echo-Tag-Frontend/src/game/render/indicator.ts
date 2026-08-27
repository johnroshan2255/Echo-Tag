import { IT_RING_COLOR, MAX_PLAYERS, NO_SLOT, PLAYER_COLORS, type World } from '@echo-tag/shared'
import { Container, Graphics } from 'pixi.js'
import { inView, type Camera } from '../engine/camera.ts'

/**
 * The off-screen threat arrow.
 *
 * The price of the follow camera is that "It" can be anywhere, unseen — and a tag landing
 * from off-screen with zero warning feels like the game cheated. This arrow is the
 * compensating control: it sits at the screen edge pointing toward what matters and its
 * meaning depends on who you are.
 *
 *   - You are NOT It → the arrow points at It, tinted white: it marks *danger*, and its
 *     absence means It is on screen and you can see the threat directly.
 *   - You ARE It → the arrow points at your nearest taggable player, tinted their colour:
 *     it marks *prey*. Without this, being It on a big map is aimless wandering, which
 *     both plays badly and starves the round of tags.
 *
 * It renders in SCREEN space (the overlay container the camera never touches), and hides
 * whenever the target is visible — an arrow pointing at something you can already see is
 * noise.
 */

export interface IndicatorLayer {
  container: Container
  arrow: Graphics
}

export const createIndicatorLayer = (): IndicatorLayer => {
  const arrow = new Graphics()
  // A chevron pointing +x, drawn once; per-frame updates are transform-only.
  arrow.moveTo(18, 0).lineTo(-10, 11).lineTo(-4, 0).lineTo(-10, -11).closePath().fill({ color: 0xffffff })
  arrow.visible = false

  const container = new Container()
  container.addChild(arrow)
  return { container, arrow }
}

const EDGE_PX = 52 // inset from the screen edge, clear of notches and rounded corners

export const renderIndicator = (
  layer: IndicatorLayer,
  world: World,
  localSlot: number,
  cam: Camera,
  viewW: number,
  viewH: number,
  nowMs: number,
): void => {
  const arrow = layer.arrow
  const it = world.itSlot
  const turning = world.turningSlot

  if ((it < 0 && turning < 0) || world.active[localSlot] === 0) {
    arrow.visible = false
    return
  }
  // Inside a wardrobe you are blind — an arrow that still tracked the ghost would tell
  // you exactly when it is safe to step out, which is the one thing hiding must not know.
  if (world.hiddenIn[localSlot] !== NO_SLOT) {
    arrow.visible = false
    return
  }

  // Choose the target this arrow exists to reveal.
  let target = -1
  let tint = IT_RING_COLOR
  if (it < 0) {
    // The lull: nobody hunts, but the next ghost is forming — the arrow telegraphs where,
    // so the head start is spent running the right way, not guessing.
    if (turning !== localSlot) target = turning
  } else if (it !== localSlot) {
    target = it
  } else {
    // You are It: nearest taggable player.
    let bestSq = Number.POSITIVE_INFINITY
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (s === localSlot || world.active[s] === 0) continue
      if (world.tick < world.immuneUntilTick[s]!) continue
      const dx = world.x[s]! - world.x[localSlot]!
      const dy = world.y[s]! - world.y[localSlot]!
      const dSq = dx * dx + dy * dy
      if (dSq < bestSq) {
        bestSq = dSq
        target = s
      }
    }
    if (target >= 0) tint = PLAYER_COLORS[world.colorSlot[target]! % PLAYER_COLORS.length]!
  }

  if (target < 0 || inView(cam, world.x[target]!, world.y[target]!, -30)) {
    arrow.visible = false
    return
  }

  // Direction from the view centre to the target, in screen space.
  const dx = world.x[target]! - cam.cx
  const dy = world.y[target]! - cam.cy
  const angle = Math.atan2(dy, dx)

  // Intersect the ray with the inset screen rectangle.
  const hw = viewW / 2 - EDGE_PX
  const hh = viewH / 2 - EDGE_PX
  const t = Math.min(hw / Math.max(Math.abs(Math.cos(angle)), 1e-6), hh / Math.max(Math.abs(Math.sin(angle)), 1e-6))

  arrow.visible = true
  arrow.x = viewW / 2 + Math.cos(angle) * t
  arrow.y = viewH / 2 + Math.sin(angle) * t
  arrow.rotation = angle
  arrow.tint = tint
  // Urgency pulse: faster and brighter the closer the threat is.
  const dist = Math.sqrt(dx * dx + dy * dy)
  const near = dist < 700
  arrow.alpha = (near ? 0.75 : 0.5) + 0.25 * Math.sin(nowMs * (near ? 0.012 : 0.006))
  const s = (near ? 1.25 : 1) * Math.min(2, cam.scale / 1.6)
  arrow.scale.set(s)
}
