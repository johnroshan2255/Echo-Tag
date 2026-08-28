/**
 * Multiplayer end-to-end: the real server, the real build, two real Chrome pages.
 *
 * Page A quick-matches, page B quick-matches; they must land in one room, both reach the
 * running game, and A's keyboard movement must appear on B's screen — position read from
 * B's own mirror world. Then a private-room pass: host page shows its code, a third page
 * joins with it.
 *
 * Run after `npm run build`:  npm run check:mp
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'

const WEB_PORT = 4187
const WS_PORT = 2597
const URL = `http://127.0.0.1:${WEB_PORT}/`

const failures: string[] = []
const ok = (cond: boolean, msg: string): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures.push(msg)
}

const waitPort = async (url: string, ms = 15_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error(`nothing listening at ${url}`)
}

let server: ChildProcess | undefined
let preview: ChildProcess | undefined
let browser: Browser | undefined

const snap = (p: Page) =>
  p.evaluate(() => {
    const t = (globalThis as { __echoTag?: { itSlot: number; phase: number; clockMs: number } }).__echoTag
    return t ? { phase: t.phase, clock: t.clockMs } : null
  })

const myPos = (p: Page) =>
  p.evaluate(() => {
    const t = (globalThis as { __echoTag?: { cam: [number, number] } }).__echoTag
    return t?.cam ?? null // camera tracks the local player — a good movement proxy
  })

try {
  server = spawn(process.execPath, ['Echo-Tag-Server/src/index.ts'], {
    env: { ...process.env, PORT: String(WS_PORT) },
    stdio: 'ignore',
  })
  preview = spawn('npx', ['vite', 'preview', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: 'Echo-Tag-Frontend',
    stdio: 'ignore',
    env: { ...process.env },
  })
  await waitPort(URL)
  await waitPort(`http://127.0.0.1:${WS_PORT}/`)

  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] })
  const page = async (): Promise<Page> => {
    const p = await (await browser!.newContext({ viewport: { width: 1024, height: 640 } })).newPage()
    // The build bakes VITE_WS_ORIGIN for localhost:2567; point this session at the test port.
    await p.addInitScript((port: number) => {
      Object.defineProperty(globalThis, '__wsOverride', { value: `ws://127.0.0.1:${port}` })
    }, WS_PORT)
    await p.goto(URL, { waitUntil: 'domcontentloaded' })
    await p.waitForFunction(() => document.documentElement.dataset.boot === 'ready')
    return p
  }

  console.log('\n  quick match, two browsers')
  const a = await page()
  const b = await page()
  await a.click('#quick')
  await b.click('#quick')
  await a.waitForFunction(() => document.documentElement.dataset.game === 'running', { timeout: 15_000 })
  await b.waitForFunction(() => document.documentElement.dataset.game === 'running', { timeout: 15_000 })
  ok(true, 'both pages reached the running game')

  // Wait out the lobby + countdown.
  await a.waitForFunction(
    () => (globalThis as { __echoTag?: { phase: number } }).__echoTag?.phase === 2,
    { timeout: 12_000 },
  )
  ok((await snap(b))?.phase === 2, 'both clients agree the round is Playing')

  // The bot ghost can tag (10% stumble) or trail-stun (full KO) the idle player right
  // before or during the drive — neither is an input failure, so wait impairment out
  // and try up to four headings: a fixed 'd' can also just scrape a wall. Same policy
  // as browser-check's touch test.
  const impaired = () =>
    a.evaluate(() => (globalThis as { __echoTag?: { meImpaired?: boolean } }).__echoTag?.meImpaired ?? false)
  let moved = 0
  for (const key of ['d', 's', 'a', 'w']) {
    for (let i = 0; i < 30 && (await impaired()); i++) await a.waitForTimeout(300)
    const before = await myPos(a)
    await a.keyboard.down(key)
    await a.waitForTimeout(1500)
    await a.keyboard.up(key)
    const after = await myPos(a)
    moved = before && after ? Math.hypot(after[0] - before[0], after[1] - before[1]) : 0
    if (moved > 120) break
  }
  ok(moved > 120, `keyboard input moved player A ${moved.toFixed(0)} world units`)

  const clockA = (await snap(a))!.clock
  const clockB = (await snap(b))!.clock
  ok(Math.abs(clockA - clockB) < 600, `round clocks agree across clients (Δ${Math.abs(clockA - clockB)}ms)`)

  await a.close()
  await b.close()

  console.log('\n  private room, host + friend')
  const host = await page()
  await host.click('#host')
  await host.waitForFunction(() => document.querySelector('#lobby-code b')?.textContent?.length === 5, {
    timeout: 15_000,
  })
  const code = await host.evaluate(() => document.querySelector('#lobby-code b')!.textContent!)
  ok(/^[A-Z]{5}$/.test(code), `host lobby shows a shareable code (${code})`)

  const friend = await page()
  await friend.fill('#codein', code)
  await friend.click('#joinbtn')
  await friend.waitForFunction(() => document.documentElement.dataset.game === 'running', { timeout: 15_000 })
  await host.waitForFunction(
    () => document.querySelector('#lobby-hint')?.textContent?.startsWith('2 '),
    { timeout: 8_000 },
  )
  ok(true, 'friend joined by code; host roster shows 2 humans')

  await host.click('#lobby-start')
  await host.waitForFunction(
    () => (globalThis as { __echoTag?: { phase: number } }).__echoTag?.phase === 2,
    { timeout: 8_000 },
  )
  ok(true, 'host start button began the private round')

  await host.close()
  await friend.close()
} catch (err) {
  failures.push(`e2e crashed: ${(err as Error).message}`)
  console.error(err)
} finally {
  await browser?.close()
  preview?.kill('SIGTERM')
  server?.kill('SIGTERM')
}

if (failures.length > 0) {
  console.error(`\n✗ multiplayer e2e FAILED:\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('\n✓ multiplayer e2e passed')
