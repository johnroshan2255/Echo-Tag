/**
 * Phase 1 exit gate.
 *
 * Two passes, because the two things we need to prove cannot be measured at once:
 *
 *   PASS A — step cost. Times every tick of a full 12-player, 3-minute round.
 *     `stepWorld` runs 20x/sec per room on the server, and again on every client for
 *     prediction plus reconciliation replay, so it gets a 0.4ms budget.
 *
 *   PASS B — allocation. Re-runs the sim in child processes under
 *     `--max-semi-space-size=1 --trace-gc` and counts scavenges. A tiny young generation
 *     turns "allocates a few bytes per tick" into "collects constantly", which is
 *     otherwise invisible: `process.memoryUsage().heapUsed` is useless here because it
 *     drifts by hundreds of KB from JIT bookkeeping alone, and `performance.now()` itself
 *     allocates ~128 bytes per call, so Pass A cannot measure allocation.
 *
 *     Pass B runs three modes and compares them:
 *       floor   — the input driver only, no simulation
 *       real    — the input driver plus stepWorld
 *       control — real, plus one deliberate 2-field object per tick
 *     `real` must sit at the floor, and `control` must sit clearly above it. That second
 *     assertion is the point: it proves the gate can still detect allocation. A silently
 *     blind gate is worse than no gate, and this one caught two real regressions already
 *     (see the perf notes in sim/player.ts and math/collision.ts).
 *
 * Run: npm run bench:sim
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  COUNTDOWN_MS,
  MAX_PLAYERS,
  ROUND_DURATION_MS,
  RoundPhase,
  TICK_MS,
  addPlayer,
  createWorld,
  encodeInput,
  enterPhase,
  leaderboard,
  stepWorld,
  type World,
} from '../../Echo-Tag-Shared/src/index.ts'

const ROUND_TICKS = Math.ceil(ROUND_DURATION_MS / TICK_MS) // 3600
const COUNTDOWN_TICKS = Math.ceil(COUNTDOWN_MS / TICK_MS) // 30
const TICKS = COUNTDOWN_TICKS + ROUND_TICKS

const STEP_BUDGET_MS = 0.4
const ALLOC_TICKS = 120_000
/** Scavenges above floor that we treat as noise rather than garbage. */
const ALLOC_TOLERANCE = 4
/** The control must exceed the floor by at least this, or the gate is not sensitive. */
const CONTROL_MIN_SIGNAL = 15

// ── Synthetic input driver ───────────────────────────────────────────────────
// Deliberately NOT the real bot AI (that is Phase 6) — this measures the simulation, not
// the brains. Each agent orbits with a per-slot phase offset and reverses periodically,
// which is what actually stresses the sim: constant direction changes produce dense,
// self-intersecting echo trails and plenty of collision contacts.
const inputs = new Uint8Array(MAX_PLAYERS)

const driveInputs = (tick: number): void => {
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const phase = s * 0.7 + tick * 0.06
    const flip = (tick + s * 17) % 71 < 35 ? 1 : -1
    inputs[s] = encodeInput(Math.cos(phase) * flip, Math.sin(phase * 1.3) * flip)
  }
}

const newRound = (seed: number): World => {
  const w = createWorld(seed)
  for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(w, i >= 4) // 4 "humans", 8 bots
  enterPhase(w, RoundPhase.Countdown)
  return w
}

const warmUp = (ticks: number): void => {
  const w = newRound(0x5eed01)
  for (let t = 0; t < ticks; t++) {
    driveInputs(t)
    stepWorld(w, inputs)
    if (w.phase === RoundPhase.Leaderboard) enterPhase(w, RoundPhase.Countdown)
  }
}

// ── Pass B child ─────────────────────────────────────────────────────────────
// Runs before anything else so the child does no extra work. Output is the trace-gc
// stream on stderr, which the parent counts.
const childMode = process.argv[2]
if (childMode === 'floor' || childMode === 'real' || childMode === 'control') {
  warmUp(3000)
  const w = newRound(0xa110c)
  const sink: unknown[] = []
  for (let t = 0; t < ALLOC_TICKS; t++) {
    driveInputs(t)
    if (childMode !== 'floor') stepWorld(w, inputs)
    if (childMode === 'control') {
      sink.length = 0
      sink.push({ x: w.x[0], y: w.y[0] })
    }
    if (w.phase === RoundPhase.Leaderboard) enterPhase(w, RoundPhase.Countdown)
  }
  process.exit(0)
}

// ── Pass A: step cost ────────────────────────────────────────────────────────
warmUp(600)

const world = newRound(0xec07a6)
const samples = new Float64Array(TICKS)
let measured = 0
let tags = 0

const wallStart = performance.now()
for (let t = 0; t < TICKS; t++) {
  driveInputs(t)
  const t0 = performance.now()
  const ev = stepWorld(world, inputs)
  samples[measured++] = performance.now() - t0
  tags += ev.tagCount
  if (ev.roundEnded) break
}
const wallMs = performance.now() - wallStart

const used = samples.slice(0, measured).sort()
const at = (q: number): number => used[Math.min(used.length - 1, Math.floor(used.length * q))]!
const mean = used.reduce((a, b) => a + b, 0) / used.length

// ── Pass B: allocation ───────────────────────────────────────────────────────
const self = fileURLToPath(import.meta.url)

const scavengesFor = (mode: string): number => {
  const r = spawnSync(
    process.execPath,
    ['--max-semi-space-size=1', '--trace-gc', self, mode],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  let n = 0
  for (const line of out.split('\n')) if (line.includes('Scavenge')) n++
  return n
}

const floor = scavengesFor('floor')
const real = scavengesFor('real')
const control = scavengesFor('control')

// ── Report ───────────────────────────────────────────────────────────────────
const board = leaderboard(world)
let liveBodies = 0
for (const b of world.bodyLive) liveBodies += b
const ms = (n: number): string => `${n.toFixed(4)} ms`

console.log(`
Echo Tag — simulation benchmark
  node ${process.version}   ${MAX_PLAYERS} players   ${measured} ticks @ ${1000 / TICK_MS}Hz

  PASS A  step cost
    mean ${ms(mean)}   p50 ${ms(at(0.5))}   p95 ${ms(at(0.95))}   p99 ${ms(at(0.99))}   max ${ms(used[used.length - 1]!)}
    budget ${ms(STEP_BUDGET_MS)}/tick  →  ${((mean / STEP_BUDGET_MS) * 100).toFixed(1)}% used at the mean
    ${wallMs.toFixed(1)} ms to simulate ${((measured * TICK_MS) / 1000).toFixed(1)}s of play (${((measured * TICK_MS) / wallMs).toFixed(0)}x realtime)

  PASS B  allocation — scavenges over ${ALLOC_TICKS.toLocaleString()} ticks, 1MB young gen
    floor   ${String(floor).padStart(4)}   (input driver only)
    real    ${String(real).padStart(4)}   (+ stepWorld)          → ${real - floor} above floor
    control ${String(control).padStart(4)}   (+ 1 object / tick)   → ${control - floor} above floor, proves the gate can see garbage

  ROUND
    arena ${world.arenaW}x${world.arenaH}   ${liveBodies} solid echo bodies   ${tags} tags
    clock ${(world.clockMs / 1000).toFixed(1)}s of ${ROUND_DURATION_MS / 1000}s   phase ${world.phase}
    best  rank 1  ${(board[0]!.itTimeMs / 1000).toFixed(1)}s as It
    worst rank ${board.length}  ${(board[board.length - 1]!.itTimeMs / 1000).toFixed(1)}s as It
`)

// ── Gate ─────────────────────────────────────────────────────────────────────
const failures: string[] = []
if (mean > STEP_BUDGET_MS) failures.push(`mean step ${ms(mean)} exceeds the ${ms(STEP_BUDGET_MS)} budget`)
if (at(0.99) > STEP_BUDGET_MS * 3) failures.push(`p99 step ${ms(at(0.99))} exceeds 3x budget`)
if (measured !== TICKS) failures.push(`expected ${TICKS} ticks (countdown + round), ran ${measured}`)
if (world.clockMs < ROUND_DURATION_MS) {
  failures.push(`round did not complete: ${(world.clockMs / 1000).toFixed(1)}s of ${ROUND_DURATION_MS / 1000}s`)
}
if (tags === 0) failures.push('no tags occurred — tag resolution is not firing')
if (real - floor > ALLOC_TOLERANCE) {
  failures.push(
    `stepWorld allocates: ${real - floor} scavenges above floor (tolerance ${ALLOC_TOLERANCE}). ` +
      `Look for a mixed Smi/double local or a module-scope double in the tick path.`,
  )
}
if (control - floor < CONTROL_MIN_SIGNAL) {
  failures.push(
    `allocation gate is not sensitive: the control only produced ${control - floor} scavenges ` +
      `above floor (need ${CONTROL_MIN_SIGNAL}). The gate cannot be trusted — fix it before trusting 'real'.`,
  )
}

if (failures.length > 0) {
  console.error(`✗ Phase 1 gate FAILED:\n  - ${failures.join('\n  - ')}\n`)
  process.exit(1)
}
console.log('✓ Phase 1 gate passed: within step budget, and the tick path is allocation-free\n')
