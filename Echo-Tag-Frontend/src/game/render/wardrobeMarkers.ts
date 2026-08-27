import {
  MAX_WARDROBES,
  NO_SLOT,
  wardrobeCenterX,
  wardrobeCenterY,
  type World,
} from '@echo-tag/shared'
import { Container, Graphics } from 'pixi.js'
import { KEYHOLE_ICON, KEY_ICON, paintIcon } from './pixelIcons.ts'

/**
 * Keyhole markers and floor keys.
 *
 * Keys start the round lying on the floor (one per wardrobe, seeded-random spots): a
 * golden key glyph bobs and glints until somebody walks over it. Once YOU hold a key, a
 * small warm keyhole floats over the wardrobe it opens: solid when ready, dimmed to a
 * sliver while that wardrobe is refusing you (the 20s cooldown). No key, no marker: a
 * wardrobe you cannot use should read as furniture, not as a taunt. Keys on the floor
 * are public information (everyone races for them); keyholes are yours alone.
 */

export interface MarkerLayer {
  container: Container
  markers: Graphics[]
  /** Floor keys, visible until claimed. */
  keys: Graphics[]
}

export const createMarkerLayer = (): MarkerLayer => {
  const container = new Container()
  const markers: Graphics[] = []
  for (let i = 0; i < MAX_WARDROBES; i++) {
    const m = new Graphics()
    // A pixel-art keyhole, drawn once; per-frame changes are transform/alpha only.
    paintIcon(m, KEYHOLE_ICON, 2.6)
    m.visible = false
    container.addChild(m)
    markers.push(m)
  }
  const keys: Graphics[] = []
  for (let i = 0; i < MAX_WARDROBES; i++) {
    const k = new Graphics()
    // A pixel-art key. Drawn once, animated by transform.
    paintIcon(k, KEY_ICON, 2.4)
    k.visible = false
    container.addChild(k)
    keys.push(k)
  }
  return { container, markers, keys }
}

export const renderMarkers = (
  layer: MarkerLayer,
  world: World,
  localSlot: number,
  nowMs: number,
): void => {
  const count = world.map.wardrobes.length / 4
  const hidden = world.hiddenIn[localSlot] !== NO_SLOT

  for (let i = 0; i < MAX_WARDROBES; i++) {
    const m = layer.markers[i]!
    if (i >= count || hidden || world.keys[localSlot * MAX_WARDROBES + i] === 0) {
      m.visible = false
      continue
    }
    m.visible = true
    m.x = wardrobeCenterX(world.map, i)
    m.y = wardrobeCenterY(world.map, i) - 56 // floats above the cabinet
    const ready = world.tick >= world.wardrobeCooldownUntil[localSlot * MAX_WARDROBES + i]!
    m.alpha = ready ? 0.75 + 0.2 * Math.sin(nowMs * 0.004) : 0.18
    m.scale.set(ready ? 1 : 0.8)
  }

  // Floor keys: bob and glint until someone claims them.
  for (let i = 0; i < MAX_WARDROBES; i++) {
    const k = layer.keys[i]!
    if (i >= count || world.keyTaken[i] === 1) {
      k.visible = false
      continue
    }
    k.visible = true
    k.x = world.keyX[i]!
    // Bob only — no rotation: a rotated pixel grid smears, and crisp is the whole point.
    k.y = world.keyY[i]! - 6 + Math.sin(nowMs * 0.003 + i * 1.7) * 4
    k.alpha = 0.8 + 0.2 * Math.sin(nowMs * 0.006 + i * 2.3)
  }
}
