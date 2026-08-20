/**
 * Headless Chrome smoke check.
 *
 * Runs against the **production build** served by `vite preview`, not the dev server, so
 * what it exercises is the artifact that would actually ship. It answers the questions a
 * unit test cannot:
 *
 *   - does the page boot at all, with zero console errors or unhandled rejections?
 *   - is the Play button interactive, and how quickly?
 *   - does a WebGL2 context come up and does the render loop actually advance frames?
 *   - does it lay out without overflow on desktop, mobile portrait and mobile landscape
 *     (Poki requires all three)?
 *
 * It drives the Chrome already installed on this machine (`channel: 'chrome'`) rather than
 * downloading a Chromium, so there is no extra 150MB in the toolchain.
 *
 * ON FRAME RATE: headless Chrome here gets a *hardware* WebGL2 context through ANGLE (the
 * `gl:` line below names the renderer), so the FPS figure is real — but it is real for
 * *this* machine's GPU, which is nothing like a mid-range Android. Treat it as a
 * regression signal ("did we just get 3x slower?"), never as evidence of meeting the
 * 30/60fps requirement. That is verified on real hardware in Phase 8.
 *
 * Run: npm run check:browser  [-- --headed]
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium, type Browser, type ConsoleMessage } from 'playwright'

const PORT = 4183
const URL = `http://127.0.0.1:${PORT}/`
const SHOTS = 'tools/check/screenshots'
const HEADED = process.argv.includes('--headed')

/** Poki requires desktop, portrait and landscape to all work. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile-portrait', width: 390, height: 844, mobile: true },
  { name: 'mobile-landscape', width: 844, height: 390, mobile: true },
] as const

const failures: string[] = []
const fail = (msg: string): void => {
  failures.push(msg)
  console.log(`    ✗ ${msg}`)
}
const pass = (msg: string): void => console.log(`    ✓ ${msg}`)

// ── Serve the built artifact ─────────────────────────────────────────────────
const startPreview = async (): Promise<ChildProcess> => {
  const proc = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: 'Echo-Tag-Frontend', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return proc
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  proc.kill('SIGKILL')
  throw new Error(`vite preview did not come up on ${URL} — did \`npm run build\` succeed?`)
}

await mkdir(SHOTS, { recursive: true })
console.log(`\nEcho Tag — headless Chrome check\n  serving Echo-Tag-Frontend/dist at ${URL}`)
const preview = await startPreview()

let browser: Browser | undefined
try {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: !HEADED,
    // Deliberately NO --use-angle=swiftshader here. Modern headless Chrome already gets a
    // hardware WebGL2 context through ANGLE on both macOS (Metal) and Windows, and forcing
    // SwiftShader not only makes the numbers meaningless, it makes PixiJS's context request
    // fail outright — a raw `getContext('webgl2')` succeeds under SwiftShader but Pixi's
    // attribute set does not. On a GPU-less Linux CI runner you *will* need
    // `--enable-unsafe-swiftshader`, and the renderer will need
    // `failIfMajorPerformanceCaveat: false` to go with it.
    args: ['--hide-scrollbars', '--mute-audio'],
  })
  const version = browser.version()
  console.log(`  chrome ${version}${HEADED ? ' (headed)' : ' (headless)'}`)

  for (const vp of VIEWPORTS) {
    console.log(`  ${vp.name}  ${vp.width}x${vp.height}`)

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.mobile ? 3 : 2,
      hasTouch: vp.mobile,
      isMobile: vp.mobile,
    })
    const page = await context.newPage()
    if (vp === VIEWPORTS[0]) {
      const gpu = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2')
        if (!gl) return 'no webgl2'
        const d = gl.getExtension('WEBGL_debug_renderer_info')
        return d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : 'unknown renderer'
      })
      console.log(`  gl: ${gpu}\n`)
    }

    // Anything Chrome complains about is a failure. The Poki SDK is served from a CDN we
    // deliberately do not reach in CI, so its own network noise is filtered out — the
    // game is required to boot without it.
    const errors: string[] = []
    const isSdkNoise = (t: string): boolean =>
      t.includes('poki') || t.includes('game-cdn') || t.includes('ERR_NAME_NOT_RESOLVED')
    page.on('console', (m: ConsoleMessage) => {
      const t = m.text()
      // The generic resource-load line is redundant with the response/requestfailed
      // listeners below, which name the URL.
      if (m.type() === 'error' && !isSdkNoise(t) && !t.startsWith('Failed to load resource')) {
        errors.push(`console: ${t}`)
      }
    })
    page.on('pageerror', (e) => {
      if (!isSdkNoise(String(e))) errors.push(`pageerror: ${e.message}`)
    })
    // A bare "Failed to load resource" console line does not say *which* resource, which
    // makes a 404 needlessly hard to chase. Record the URL instead.
    page.on('requestfailed', (r) => {
      if (!isSdkNoise(r.url())) errors.push(`request failed: ${r.url()} (${r.failure()?.errorText ?? 'unknown'})`)
    })
    page.on('response', (r) => {
      if (r.status() >= 400 && !isSdkNoise(r.url())) errors.push(`HTTP ${r.status()}: ${r.url()}`)
    })

    const t0 = Date.now()
    await page.goto(URL, { waitUntil: 'domcontentloaded' })

    // ── Boot ──
    try {
      await page.waitForFunction(() => document.documentElement.dataset.boot === 'ready', {
        timeout: 8000,
      })
      const bootMs = Date.now() - t0
      pass(`boot ready in ${bootMs}ms (localhost — see PERFORMANCE_BUDGET.md for the network model)`)
    } catch {
      fail('boot never signalled ready')
    }

    // ── Preview actually painted, and composed inside the frame ──
    // A single-line sample only proves "not blank". It cannot tell a well-framed arena from
    // one whose trails have run off the edge, which is a mistake we have already made once.
    // So: sample the whole canvas, count distinct bright colours, and require content in
    // every quadrant.
    const painted = await page.evaluate(() => {
      const c = document.getElementById('preview') as HTMLCanvasElement | null
      if (!c || c.width === 0 || c.height === 0) return { ok: false, reason: 'canvas missing or zero-sized' }
      const ctx = c.getContext('2d')
      if (!ctx) return { ok: false, reason: 'no 2d context' }

      const { width: w, height: h } = c
      const d = ctx.getImageData(0, 0, w, h).data
      const colours = new Set<number>()
      const quadrants = [0, 0, 0, 0]

      // Step in device pixels; a coarse grid is plenty and keeps this fast.
      const step = Math.max(2, Math.round(Math.min(w, h) / 220))
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const o = (y * w + x) * 4
          const r = d[o]!
          const g = d[o + 1]!
          const b = d[o + 2]!
          // Anything clearly brighter than the #12141c background counts as content.
          if (r + g + b < 150) continue
          colours.add((r >> 4 << 8) | (g >> 4 << 4) | (b >> 4))
          quadrants[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)]!++
        }
      }

      const empty = quadrants.filter((n) => n === 0).length
      return {
        ok: colours.size >= 4 && empty === 0,
        reason: `${colours.size} distinct colours, quadrant coverage ${quadrants.join('/')}`,
      }
    })
    painted.ok
      ? pass(`preview composed in frame (${painted.reason})`)
      : fail(`preview poorly composed — expected 4+ colours and content in all four quadrants: ${painted.reason}`)

    // ── Canvases fill the viewport exactly ──
    // Checked explicitly because `overflow: hidden` on <html> hides the symptom from a
    // scrollWidth comparison: a canvas laid out at twice the viewport size looks fine to
    // the overflow check while silently pushing half the arena off-screen.
    const sizes = await page.evaluate(() => {
      const read = (id: string) => {
        const c = document.getElementById(id) as HTMLCanvasElement | null
        return c ? { id, css: [c.clientWidth, c.clientHeight], backing: [c.width, c.height] } : null
      }
      return { dpr: devicePixelRatio, view: [innerWidth, innerHeight], canvases: [read('stage'), read('preview')] }
    })
    for (const c of sizes.canvases) {
      if (!c) {
        fail('a canvas is missing')
        continue
      }
      const [cw, ch] = c.css
      const [vw, vh] = sizes.view
      if (Math.abs(cw! - vw!) > 1 || Math.abs(ch! - vh!) > 1) {
        fail(`#${c.id} is laid out at ${cw}x${ch} CSS px in a ${vw}x${vh} viewport`)
      } else if (c.backing[0] !== Math.round(vw! * Math.min(sizes.dpr, 2))) {
        fail(`#${c.id} backing store ${c.backing.join('x')} does not match ${vw}x${vh} @ dpr ${Math.min(sizes.dpr, 2)}`)
      } else {
        pass(`#${c.id} ${cw}x${ch} CSS / ${c.backing.join('x')} backing`)
      }
    }

    // ── No horizontal overflow (Poki responsiveness) ──
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    overflow.scroll <= overflow.client
      ? pass('no horizontal overflow')
      : fail(`page overflows horizontally: ${overflow.scroll}px content in ${overflow.client}px viewport`)

    // ── Play button reachable and inside the safe area ──
    const play = page.locator('#play')
    const box = await play.boundingBox()
    if (!box) {
      fail('Play button has no layout box')
    } else if (box.x < 8 || box.y < 8 || box.x + box.width > vp.width - 8 || box.y + box.height > vp.height - 8) {
      fail(`Play button clipped by the viewport: ${JSON.stringify(box)}`)
    } else {
      pass(`Play button on screen at ${Math.round(box.x)},${Math.round(box.y)}`)
    }

    await page.screenshot({ path: `${SHOTS}/${vp.name}-boot.png` })

    // ── Start the game ──
    await play.click({ timeout: 4000 }).catch(() => fail('Play button did not accept a click'))
    try {
      await page.waitForFunction(() => document.documentElement.dataset.game === 'running', {
        timeout: 15_000,
      })
      pass('game chunk loaded and WebGL renderer started')
    } catch {
      fail('game never reached the running state')
    }

    // ── Frame loop is advancing ──
    const f0 = await page.evaluate(() => (globalThis as { __echoTagFrames?: number }).__echoTagFrames ?? -1)
    await page.waitForTimeout(1500)
    const f1 = await page.evaluate(() => (globalThis as { __echoTagFrames?: number }).__echoTagFrames ?? -1)
    const particles = await page.evaluate(() => Number(document.documentElement.dataset.particles ?? 0))

    if (f0 < 0 || f1 <= f0) {
      fail(`render loop is not advancing (frames ${f0} → ${f1})`)
    } else {
      const fps = ((f1 - f0) / 1.5).toFixed(1)
      pass(`${f1 - f0} frames in 1.5s = ${fps} fps with ${particles} particles (this GPU only — not a phone)`)
    }

    await page.screenshot({ path: `${SHOTS}/${vp.name}-game.png` })

    if (errors.length > 0) for (const e of errors) fail(e)
    else pass('no console errors')

    await context.close()
    console.log('')
  }
} finally {
  await browser?.close()
  preview.kill('SIGTERM')
}

console.log(`  screenshots → ${SHOTS}/\n`)
if (failures.length > 0) {
  console.error(`✗ browser check FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}\n`)
  process.exit(1)
}
console.log('✓ browser check passed on all three viewports\n')
