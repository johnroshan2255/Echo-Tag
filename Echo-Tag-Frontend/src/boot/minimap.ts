import { MAP_TILES_X, MAP_TILES_Y, TILE_WALL, TILE_FURNITURE } from '@echo-tag/shared'
import type { GameMap } from '@echo-tag/shared'

const cosmeticRng = (seed: number): (() => number) => {
  let s = (seed | 0) + 0x6d2b79f5
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1)
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61)
    return ((s ^ (s >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

export const drawMinimap = (ctx: CanvasRenderingContext2D, map: GameMap, canvasW: number, canvasH: number) => {
  const rng = cosmeticRng(0xc02e + map.index * 977)
  const TILE = 10
  const TILES_W = Math.ceil(canvasW / TILE)
  const TILES_H = Math.ceil(canvasH / TILE)
  const startX = Math.floor((MAP_TILES_X - TILES_W) / 2)
  const startY = Math.floor((MAP_TILES_Y - TILES_H) / 2)
  const walls = map.walls
  const openTiles = map.openTiles

  ctx.fillStyle = '#262038' // FLOOR
  ctx.fillRect(0, 0, canvasW, canvasH)

  // Speckles
  const SPECKLES = 900
  ctx.fillStyle = '#342c4c'
  for (let i = 0; i < SPECKLES; i++) {
    const tile = openTiles[Math.floor(rng() * openTiles.length)]!
    const tx = tile % MAP_TILES_X - startX
    const ty = Math.floor(tile / MAP_TILES_X) - startY
    if (tx < -1 || ty < -1 || tx > TILES_W || ty > TILES_H) { rng(); continue }
    const x = tx * TILE + rng() * TILE
    const y = ty * TILE + rng() * TILE
    const s = rng() < 0.25 ? 1.5 : 1
    ctx.fillRect(x, y, s, s)
  }

  // Cracks
  for (let i = 0; i < 26; i++) {
    const tile = openTiles[Math.floor(rng() * openTiles.length)]!
    const tx = tile % MAP_TILES_X - startX
    const ty = Math.floor(tile / MAP_TILES_X) - startY
    let x = tx * TILE + rng() * TILE
    let y = ty * TILE + rng() * TILE
    let a = rng() * Math.PI * 2
    const segs = 3 + Math.floor(rng() * 3)
    
    ctx.beginPath()
    ctx.moveTo(x, y)
    const litPts = [x, y]
    for (let k = 0; k < segs; k++) {
      a += (rng() - 0.5) * 1.6
      x += Math.cos(a) * (3 + rng() * 4)
      y += Math.sin(a) * (3 + rng() * 4)
      ctx.lineTo(x, y)
      litPts.push(x, y)
    }
    ctx.strokeStyle = '#17131f'
    ctx.lineWidth = 1
    ctx.stroke()
    
    ctx.beginPath()
    ctx.moveTo(litPts[0]! + 0.5, litPts[1]! + 0.5)
    for (let k = 2; k < litPts.length; k += 2) ctx.lineTo(litPts[k]! + 0.5, litPts[k+1]! + 0.5)
    ctx.strokeStyle = '#3d3552'
    ctx.lineWidth = 0.5
    ctx.stroke()

    if (rng() < 0.55) {
      for (let r = 0; r < 3 + Math.floor(rng() * 3); r++) {
        const sz = 0.5 + rng() * 1
        ctx.fillStyle = rng() < 0.5 ? '#37304a' : '#241f33'
        ctx.fillRect(x + (rng() - 0.5) * 6, y + (rng() - 0.5) * 6, sz, sz)
      }
    }
  }

  // Rugs
  const decor = map.decor
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== 2) continue // Decor.Rug is 2
    const tx = decor[i+1]! - startX
    const ty = decor[i+2]! - startY
    if (tx < -3 || ty < -2 || tx > TILES_W || ty > TILES_H) continue
    const x = tx * TILE
    const y = ty * TILE
    const rw = TILE * 3
    const rh = TILE * 2
    ctx.fillStyle = '#59303f'
    ctx.globalAlpha = 0.55
    ctx.fillRect(x, y, rw, rh)
    ctx.globalAlpha = 1.0
    ctx.strokeStyle = '#7a4457'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, rw, rh)
  }

  // Draw walls and furniture
  for (let ty = -1; ty <= TILES_H; ty++) {
    for (let tx = -1; tx <= TILES_W; tx++) {
      const mx = startX + tx
      const my = startY + ty
      if (mx < 0 || my < 0 || mx >= MAP_TILES_X || my >= MAP_TILES_Y) continue
      const tile = walls[my * MAP_TILES_X + mx]
      
      const x = tx * TILE
      const y = ty * TILE

      if (tile === TILE_WALL) {
        ctx.fillStyle = '#14231d'
        ctx.fillRect(x, y, TILE, TILE)
        // Tufts
        const n = 2 + Math.floor(rng() * 2)
        ctx.fillStyle = '#243b2e'
        for (let k = 0; k < n; k++) {
          const s = 1.5 + rng() * 2
          ctx.globalAlpha = 0.35 + rng() * 0.4
          ctx.fillRect(x + 1 + rng() * (TILE - 2 - s), y + 1 + rng() * (TILE - 2 - s), s, s)
        }
        ctx.globalAlpha = 1.0
        // Bottom rim
        if (my + 1 < MAP_TILES_Y && walls[(my + 1) * MAP_TILES_X + mx] !== TILE_WALL) {
          ctx.fillStyle = '#4a6b52'
          ctx.globalAlpha = 0.8
          ctx.fillRect(x, y + TILE - 1, TILE, 1.5)
          ctx.globalAlpha = 1.0
        }
      } else if (tile === TILE_FURNITURE) {
        ctx.fillStyle = '#33241a'
        ctx.globalAlpha = 0.8
        ctx.fillRect(x + 0.5, y + TILE - 1.5, TILE - 1, 1.5)
        ctx.globalAlpha = 1.0
        ctx.fillStyle = '#4a3527'
        ctx.fillRect(x + 0.5, y + 0.5, TILE - 1, TILE - 2)
        ctx.fillStyle = '#5d4433'
        ctx.fillRect(x + 0.5, y + 0.5, TILE - 1, 1)
        for (let px = x + 2.5; px < x + TILE - 1.5; px += 3) {
          ctx.fillStyle = '#33241a'
          ctx.globalAlpha = 0.5
          ctx.fillRect(px, y + 1.5, 0.5, TILE - 3)
          ctx.globalAlpha = 1.0
        }
      }
    }
  }

  // Windows
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== 1) continue // Decor.Window is 1
    const tx = decor[i+1]! - startX
    const ty = decor[i+2]! - startY
    if (tx < 0 || ty < 0 || tx > TILES_W || ty > TILES_H) continue
    const x = tx * TILE
    const y = ty * TILE
    ctx.fillStyle = '#2a2337'
    ctx.fillRect(x + 2, y + 2.5, TILE - 4, TILE - 5)
    ctx.fillStyle = '#ffe3ad'
    ctx.globalAlpha = 0.6
    ctx.fillRect(x + 2.5, y + 3, TILE - 5, TILE - 6)
    ctx.globalAlpha = 1.0
    ctx.fillStyle = '#2a2337'
    ctx.fillRect(x + TILE/2 - 0.5, y + 2.5, 1, TILE - 5)
    ctx.fillRect(x + 2.5, y + TILE/2 - 0.5, TILE - 5, 1)
  }

  // Fog vignette
  const cx = canvasW / 2
  const cy = canvasH / 2
  const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, canvasW * 0.7)
  grad.addColorStop(0, 'rgba(15, 11, 26, 0)')
  grad.addColorStop(1, 'rgba(15, 11, 26, 0.8)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvasW, canvasH)
}
