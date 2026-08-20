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

    // Count WebGL draw calls per frame, by wrapping the context the page is handed.
    // Draw-call count is the number that actually predicts mobile performance for this
    // renderer: the whole design rests on two ParticleContainers batching the entire arena,
    // and a regression there (an accidental extra container, a filter, a Graphics rebuild
    // per frame) would not show up in fps on a desktop GPU but would wreck a phone.
    await page.addInitScript(() => {
      const stats = { calls: 0, frames: 0, maxPerFrame: 0 }
      ;(globalThis as { __gl?: typeof stats }).__gl = stats

      const orig = HTMLCanvasElement.prototype.getContext as (
        this: HTMLCanvasElement,
        id: string,
        opts?: unknown,
      ) => RenderingContext | null
      HTMLCanvasElement.prototype.getContext = function (id: string, opts?: unknown) {
        const ctx = orig.call(this, id, opts)
        if (ctx && (id === 'webgl2' || id === 'webgl')) {
          const gl = ctx as WebGL2RenderingContext
          for (const m of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
            const fn = gl[m] as (...a: unknown[]) => unknown
            if (typeof fn !== 'function') continue
            ;(gl as unknown as Record<string, unknown>)[m] = function (...a: unknown[]) {
              stats.calls++
              return fn.apply(gl, a)
            }
          }
        }
        return ctx
      } as typeof HTMLCanvasElement.prototype.getContext

      // Sample per frame so we can report a per-frame maximum, not just an average.
      let lastCalls = 0
      const tick = () => {
        const d = stats.calls - lastCalls
        lastCalls = stats.calls
        if (stats.frames > 0 && d > stats.maxPerFrame) stats.maxPerFrame = d
        stats.frames++
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
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

    // ── Let the arena reach full echo density before measuring ──
    // The trail takes ECHO_DELAY_MS to fill, so measuring immediately measures an empty
    // arena. Phase 2's gate is about the *dense* arena, which is the hard case.
    await page.waitForTimeout(3500)

    type Snap = {
      frames: number
      ticks: number
      dropped: number
      liveEchoBodies: number
      arena: [number, number]
      camScale: number
    }
    const read = () => page.evaluate(() => (globalThis as { __echoTag?: Snap }).__echoTag)
    const s0 = (await read()) as Snap | undefined
    await page.waitForTimeout(2000)
    const s1 = (await read()) as Snap | undefined
    const particles = await page.evaluate(() => Number(document.documentElement.dataset.particles ?? 0))
    const gl = await page.evaluate(() => (globalThis as { __gl?: { calls: number; frames: number; maxPerFrame: number } }).__gl)

    if (!s0 || !s1 || s1.frames <= s0.frames) {
      fail(`render loop is not advancing (${s0?.frames ?? -1} → ${s1?.frames ?? -1})`)
    } else {
      const fps = (s1.frames - s0.frames) / 2
      pass(`${fps.toFixed(1)} fps, ${particles} particles, ${s1.liveEchoBodies} echo bodies, arena ${s1.arena.join('x')} @ ${s1.camScale.toFixed(3)}x (this GPU only — not a phone)`)
      if (fps < 30) fail(`under 30 fps even on this GPU (${fps.toFixed(1)}) — a phone has no chance`)
    }

    // Full echo density: 12 players x 15 bodies. Anything less means the trail is not
    // filling, which would make the whole readability question untestable.
    if (s1 && s1.liveEchoBodies !== 180) {
      fail(`expected 180 solid echo bodies at full density, saw ${s1.liveEchoBodies}`)
    } else if (s1) {
      pass('echo trail fully populated (180 solid bodies)')
    }

    // Compare across the window rather than against zero: a tab that was throttled during
    // load can legitimately shed a tick or two before the loop settles. What must not happen
    // is dropping ticks in *steady state*.
    if (s0 && s1 && s1.dropped > s0.dropped) {
      fail(`ticker dropped ${s1.dropped - s0.dropped} simulation ticks in steady state — the frame loop cannot keep up`)
    } else if (s1) {
      pass(`no dropped simulation ticks in steady state (${s1.ticks} ticks stepped)`)
    }

    if (!gl || gl.maxPerFrame === 0) {
      fail('draw calls were not instrumented')
    } else if (gl.maxPerFrame > 8) {
      fail(`${gl.maxPerFrame} draw calls in a frame, budget is 8 — particle batching has broken`)
    } else {
      pass(`${gl.maxPerFrame} draw calls per frame at peak (budget 8)`)
    }

    // ── Touch steers the avatar (mobile viewports only) ──
    // The whole mobile control scheme is one floating joystick; a synthetic touch drag must
    // move the player, or the game is not actually playable on the devices Poki serves.
    if (vp.mobile) {
      const posOf = () =>
        page.evaluate(() => (globalThis as { __echoTag?: { cam: [number, number] } }).__echoTag?.cam ?? [0, 0])
      // A spawn can sit in a walled corner, where a fixed drag direction just scrapes the
      // wall and reads as failure. Direction is not what is under test — the joystick is —
      // so try up to four headings and pass on the first that produces real movement.
      const before = await posOf()
      const cdp = await context.newCDPSession(page)
      const cx = vp.width / 2
      const cy = vp.height / 2
      let dragged = 0
      let shotTaken = false
      for (const [dx, dy] of [
        [before[0]! < 1600 ? 52 : -52, 0],
        [0, before[1]! < 880 ? 52 : -52],
        [before[0]! < 1600 ? -52 : 52, 0],
        [0, before[1]! < 880 ? -52 : 52],
      ] as const) {
        const from = await posOf()
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: cx, y: cy, id: 1 }],
        })
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: cx + dx, y: cy + dy, id: 1 }],
        })
        if (!shotTaken) {
          // Capture mid-drag so the joystick base and knob are in the screenshot record.
          await page.waitForTimeout(400)
          await page.screenshot({ path: `${SHOTS}/${vp.name}-touch.png` })
          shotTaken = true
          await page.waitForTimeout(800)
        } else {
          await page.waitForTimeout(1200)
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        const to = await posOf()
        dragged = Math.hypot(to[0]! - from[0]!, to[1]! - from[1]!)
        if (dragged > 100) break
      }
      if (dragged > 100) pass(`touch drag steered the avatar ${dragged.toFixed(0)} world units`)
      else fail(`touch drag did not move the avatar (${dragged.toFixed(0)} world units)`)

      const joyVisible = await page.evaluate(
        () => (document.getElementById('joy-base') as HTMLElement | null)?.style.display,
      )
      if (joyVisible !== undefined) pass('floating joystick elements present')
      else fail('joystick elements missing from the DOM')
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
