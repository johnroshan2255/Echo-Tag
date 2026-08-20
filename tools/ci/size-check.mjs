#!/usr/bin/env node
// Bundle budget gate. Fails the build if the game can no longer load "instantly".
// Run after `npm run build` — reads the real brotli-compressed output.
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const DIST = 'Echo-Tag-Frontend/dist'
const BUDGETS = { boot: 16, engine: 160, total: 260 } // KB, brotli

const walk = async (dir) => {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    e.isDirectory() ? out.push(...(await walk(p))) : out.push(p)
  }
  return out
}

const files = (await walk(DIST)).filter((f) => f.endsWith('.br'))
if (!files.length) {
  console.error(`no .br files in ${DIST} — did the build run with vite-plugin-compression2?`)
  process.exit(1)
}

let total = 0
const rows = []
for (const f of files) {
  const kb = (await stat(f)).size / 1024
  total += kb
  rows.push([f.replace(`${DIST}/`, ''), kb])
}

rows.sort((a, b) => b[1] - a[1])
for (const [name, kb] of rows) console.log(`  ${kb.toFixed(1).padStart(7)} KB  ${name}`)
console.log(`  ${total.toFixed(1).padStart(7)} KB  TOTAL (brotli)`)

const fail = []
const named = (k) => rows.filter(([n]) => n.includes(k)).reduce((s, [, kb]) => s + kb, 0)
if (named('boot') > BUDGETS.boot) fail.push(`boot ${named('boot').toFixed(1)}KB > ${BUDGETS.boot}KB`)
if (named('engine') > BUDGETS.engine) fail.push(`engine ${named('engine').toFixed(1)}KB > ${BUDGETS.engine}KB`)
if (total > BUDGETS.total) fail.push(`total ${total.toFixed(1)}KB > ${BUDGETS.total}KB`)

if (fail.length) {
  console.error(`\n✗ bundle budget exceeded:\n  - ${fail.join('\n  - ')}`)
  process.exit(1)
}
console.log('\n✓ within bundle budget')
