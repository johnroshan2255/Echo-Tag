import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ECHO_SQUARES, SQUARES_PER_PLAYER } from '@echo-tag/shared/constants'
import { BODY, ECHO, GRID_H, GRID_W, Part } from './templates.ts'

/**
 * The template is generated from shape predicates, so a change to any parameter silently
 * changes the particle budget for the whole game. These tests pin the things that matter:
 * the cell count stays inside the band the tech doc specifies, the silhouette still has the
 * parts the animator addresses by name, and echoes stay much coarser than avatars.
 */

describe('body template', () => {
  it('lands inside the 150-250 squares-per-player band', () => {
    // Tech doc §3.2: 150-250 per live humanoid. Below reads as too coarse to be a figure;
    // above costs draw budget for detail nobody can see at this on-screen size.
    assert.ok(
      BODY.count >= 150 && BODY.count <= 250,
      `BODY has ${BODY.count} cells, outside the 150-250 band`,
    )
  })

  it('stays within the declared per-player particle slice', () => {
    assert.ok(
      BODY.count <= SQUARES_PER_PLAYER + 40,
      `BODY (${BODY.count}) has drifted far from the declared budget (${SQUARES_PER_PLAYER})`,
    )
  })

  it('has every part the animator drives', () => {
    const present = new Set(BODY.part)
    for (const [name, part] of Object.entries(Part)) {
      assert.ok(present.has(part), `template has no ${name} cells, but the animator moves them`)
    }
  })

  it('has exactly two eyes', () => {
    let eyes = 0
    for (const p of BODY.part) if (p === Part.Eye) eyes++
    assert.equal(eyes, 2)
  })

  it('has two legs of equal size, so the walk cycle is symmetric', () => {
    let l = 0
    let r = 0
    for (const p of BODY.part) {
      if (p === Part.LegL) l++
      else if (p === Part.LegR) r++
    }
    assert.equal(l, r)
    assert.ok(l > 0)
  })

  it('marks a border of edge cells for definition against the floor', () => {
    let edges = 0
    for (const e of BODY.edge) edges += e
    // Every cell on the silhouette's outline, and no more than most of the figure.
    assert.ok(edges > 30 && edges < BODY.count, `${edges} edge cells of ${BODY.count}`)
  })

  it('keeps every cell inside the grid', () => {
    for (let i = 0; i < BODY.count; i++) {
      assert.ok(BODY.gx[i]! >= 0 && BODY.gx[i]! < GRID_W)
      assert.ok(BODY.gy[i]! >= 0 && BODY.gy[i]! < GRID_H)
    }
  })
})

describe('echo template', () => {
  it('is far coarser than a live avatar', () => {
    // Not a performance rule but a readability one: every game that has shipped a past-self
    // mechanic converges on ghosts needing to be visually quieter and blockier than the live
    // actor. A 5x ratio is what made a dense arena parse in playtest crops.
    assert.ok(
      ECHO.count * 5 <= BODY.count,
      `echo (${ECHO.count}) is not markedly coarser than body (${BODY.count})`,
    )
  })

  it('matches the declared echo square budget', () => {
    assert.equal(ECHO.count, ECHO_SQUARES)
  })

  it('carries no eyes or limbs — an echo is an obstacle, not a character', () => {
    for (const p of ECHO.part) assert.equal(p, Part.Torso)
  })
})
