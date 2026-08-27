import { Container, Sprite, type Texture } from 'pixi.js'
import { LANTERN_TINT } from '../theme.ts'

/**
 * Inside the wardrobe — what the hider sees, which is almost nothing.
 *
 * The design contract (ADR 0008 / wardrobe.ts) says hiding makes you blind: you cannot
 * tell whether the chaser is still out there, and that uncertainty IS the mechanic. The
 * fog pass alone never delivered that — at HIDDEN_VISION_SCALE a hider still watched the
 * ghost stroll past the cabinet. So while the local player is hidden this overlay covers
 * the entire view with wardrobe-interior darkness: a black screen and one thin, swaying
 * slit of warm room-light between the doors. The slit is deliberately information-free —
 * its flicker is time-based, never world-based; nothing outside modulates it.
 *
 * One honest tell, matching the sim: the wardrobe will not shelter you forever
 * (WARDROBE_MAX_HIDE_MS). As eviction approaches the slit creaks wider and brighter —
 * the door is swinging open, get ready to run.
 *
 * Screen-space, square-texture sprites on normal blend: everything batches into one
 * draw call, appears only while hidden, allocates nothing per frame.
 */

export interface InteriorLayer {
  container: Container
  dark: Sprite
  /** Bright core of the door slit, plus two soft falloff bars behind it. */
  slit: Sprite
  slitSoft: Sprite
  slitWide: Sprite
}

export const createInteriorLayer = (square: Texture): InteriorLayer => {
  const container = new Container()
  container.visible = false

  const make = (tint: number): Sprite => {
    const s = new Sprite(square)
    s.anchor.set(0.5)
    s.tint = tint
    container.addChild(s)
    return s
  }

  // Order: widest glow first, darkness beneath them all is added first of all.
  const dark = new Sprite(square)
  dark.tint = 0x030208
  container.addChild(dark)
  const slitWide = make(LANTERN_TINT)
  const slitSoft = make(LANTERN_TINT)
  const slit = make(0xfff3dc)

  return { container, dark, slit, slitSoft, slitWide }
}

export const renderInterior = (
  layer: InteriorLayer,
  hidden: boolean,
  heldFrac: number, // 0..1 of the max hide time; the door creaks open toward 1
  nowMs: number,
  viewW: number,
  viewH: number,
): void => {
  if (!hidden) {
    layer.container.visible = false
    return
  }
  layer.container.visible = true

  const dark = layer.dark
  dark.x = 0
  dark.y = 0
  dark.width = viewW
  dark.height = viewH

  // The last stretch of shelter: the door eases open, the slit grows and brightens.
  const opening = Math.max(0, (heldFrac - 0.72) / 0.28)
  const t = nowMs * 0.001
  // Sway and flicker are time-only: the light never reports what is outside.
  const sway = Math.sin(t * 0.7) * viewW * 0.002
  const flicker = 0.82 + 0.1 * Math.sin(t * 5.3) + 0.08 * Math.sin(t * 12.7)

  const cx = viewW / 2 + sway
  const cy = viewH / 2
  const slitH = viewH * (0.62 + opening * 0.3)
  const coreW = viewW * (0.0022 + opening * 0.02)

  const place = (s: Sprite, w: number, alpha: number): void => {
    s.x = cx
    s.y = cy
    s.width = w
    s.height = slitH
    s.alpha = alpha
  }
  place(layer.slit, coreW, (0.5 + opening * 0.4) * flicker)
  place(layer.slitSoft, coreW * 3.2, (0.16 + opening * 0.2) * flicker)
  place(layer.slitWide, coreW * 8, (0.05 + opening * 0.1) * flicker)
}
