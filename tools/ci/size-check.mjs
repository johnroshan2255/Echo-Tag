#!/usr/bin/env node
/**
 * Bundle budget gate. Fails the build if the game can no longer load "instantly".
 *
 * Measures what a browser would actually download: the brotli file when one exists, the
 * raw file when it is below the compression threshold. Source maps are excluded — they are
 * emitted with `sourcemap: 'hidden'`, so no `sourceMappingURL` comment points at them and
 * a browser never requests one.
 *
 * Budgets are grouped by *what the player waits for*, not by file:
 *   boot   — everything needed for an interactive Play button (html + entry + runtime)
 *   engine — PixiJS, which streams in behind the Play button
 *   total  — the whole playable game
 *
 * Run after `npm run build`.
 */
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const DIST = 'Echo-Tag-Frontend/dist'

/** KB, brotli. See docs/PERFORMANCE_BUDGET.md. */
const BUDGETS = { boot: 16, engine: 160, total: 260 }

/** The boot payload: parsed and interactive before anything else may load. */
const isBoot = (name) =>
  name === 'index.html' || /(^|\/)(index|boot|rolldown-runtime)\.[^/]*\.(js|css)$/.test(name)
const isEngine = (name) => /(^|\/)engine\.[^/]*\.js$/.test(name)

const walk = async (dir) => {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}

let all
try {
  all = await walk(DIST)
} catch {
  console.error(`✗ ${DIST} not found — run \`npm run build\` first.`)
  process.exit(1)
}

const compressed = new Set(all.filter((f) => f.endsWith('.br')))
const assets = all.filter(
  (f) => !f.endsWith('.br') && !f.endsWith('.gz') && !f.endsWith('.map'),
)

if (assets.length === 0) {
  console.error(`✗ no assets in ${DIST}`)
  process.exit(1)
}

const rows = []
for (const f of assets) {
  const br = `${f}.br`
  const measured = compressed.has(br) ? br : f
  const kb = (await stat(measured)).size / 1024
  rows.push({ name: relative(DIST, f), kb, compressed: compressed.has(br) })
}
rows.sort((a, b) => b.kb - a.kb)

const sum = (pred) => rows.filter((r) => pred(r.name)).reduce((s, r) => s + r.kb, 0)
const boot = sum(isBoot)
const engine = sum(isEngine)
const total = rows.reduce((s, r) => s + r.kb, 0)

console.log('\n  transfer size (brotli where available)\n')
for (const r of rows) {
  const tag = isBoot(r.name) ? 'boot  ' : isEngine(r.name) ? 'engine' : '      '
  console.log(
    `  ${r.kb.toFixed(1).padStart(8)} KB  ${tag}  ${r.name}${r.compressed ? '' : '  (raw, under compression threshold)'}`,
  )
}

const line = (label, value, budget) => {
  const pct = ((value / budget) * 100).toFixed(0)
  const mark = value > budget ? '✗' : '✓'
  console.log(`  ${mark} ${label.padEnd(7)} ${value.toFixed(1).padStart(7)} KB of ${String(budget).padStart(4)} KB budget  (${pct}%)`)
}

console.log('')
line('boot', boot, BUDGETS.boot)
line('engine', engine, BUDGETS.engine)
line('total', total, BUDGETS.total)

const failures = []
if (boot > BUDGETS.boot) failures.push(`boot payload ${boot.toFixed(1)}KB > ${BUDGETS.boot}KB — the Play button must be interactive before anything heavy loads`)
if (engine > BUDGETS.engine) failures.push(`engine ${engine.toFixed(1)}KB > ${BUDGETS.engine}KB`)
if (total > BUDGETS.total) failures.push(`total ${total.toFixed(1)}KB > ${BUDGETS.total}KB`)

if (failures.length > 0) {
  console.error(`\n✗ bundle budget exceeded:\n  - ${failures.join('\n  - ')}\n`)
  process.exit(1)
}
console.log('\n✓ within bundle budget\n')
