/**
 * CrazyGames integration end-to-end: the real server, the real build, real Chrome pages,
 * and a scripted stand-in for the CrazyGames SDK (their SDK refuses to run off their
 * domain, so QA-tool behaviour is reproduced here and every call is recorded).
 *
 * Covers what their "Online with Friends" review checks (docs.crazygames.com/requirements/
 * multiplayer): instant multiplayer → joinable private room, updateRoom/leftRoom, invite
 * params on load, the join listener while already playing (no page reload), usernames in
 * the lobby, the SDK invite link, settings (chat disable), gameplayStart on input, and the
 * 'disabled' environment leaving the game untouched.
 *
 * Run after `npm run build`:  npm run check:cg
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'

const WEB_PORT = 4188
const WS_PORT = 2598
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

interface StubCfg {
  env?: 'local' | 'crazygames' | 'disabled'
  instant?: boolean
  invite?: Record<string, string> | null
  settings?: { muteAudio?: boolean; disableChat?: boolean }
  user?: { username: string } | null
}

/** Installs window.CrazyGames.SDK before any game script runs; records every call. */
const stubSdk = (cfg: StubCfg): string => `
  (() => {
    const cfg = ${JSON.stringify(cfg)};
    const calls = []; const settingsCbs = []; const joinCbs = [];
    const rec = (n) => (...a) => { calls.push([n, ...a]) };
    globalThis.__cg = { calls };
    globalThis.__cgFire = {
      settings: (s) => settingsCbs.forEach((cb) => cb(s)),
      join: (p) => joinCbs.forEach((cb) => cb(p)),
    };
    globalThis.CrazyGames = { SDK: {
      environment: cfg.env ?? 'crazygames',
      init: async () => { calls.push(['init']) },
      game: {
        gameplayStart: rec('gameplayStart'), gameplayStop: rec('gameplayStop'),
        loadingStart: rec('loadingStart'), loadingStop: rec('loadingStop'), happytime: rec('happytime'),
        isInstantMultiplayer: cfg.instant ?? false,
        inviteParams: cfg.invite ?? null,
        inviteLink: (p) => { calls.push(['inviteLink', p]); return 'https://www.crazygames.com/game/echo-tag?room=' + (p.room ?? p.rid) },
        updateRoom: rec('updateRoom'), leftRoom: rec('leftRoom'),
        addJoinRoomListener: (cb) => joinCbs.push(cb),
        getInviteParam: (k) => (cfg.invite ?? {})[k] ?? null,
        settings: cfg.settings ?? {},
        addSettingsChangeListener: (cb) => settingsCbs.push(cb),
      },
      ad: { requestAd: (t, cb) => { calls.push(['requestAd', t]); cb.adStarted?.(); setTimeout(() => cb.adFinished?.(), 30) } },
      user: { isUserAccountAvailable: true, getUser: async () => cfg.user ?? null },
    } };
    globalThis.__wsOverride = 'ws://127.0.0.1:${WS_PORT}';
  })();
`

type Call = [string, ...unknown[]]
const calls = (p: Page): Promise<Call[]> => p.evaluate(() => (globalThis as { __cg?: { calls: Call[] } }).__cg?.calls ?? [])
const has = (cs: Call[], name: string): boolean => cs.some((c) => c[0] === name)
const lastRoom = (cs: Call[]) =>
  cs.filter((c) => c[0] === 'updateRoom').at(-1)?.[1] as { roomId: string; isJoinable: boolean; inviteParams?: Record<string, string> } | undefined
const lobbyCode = (p: Page): Promise<string> => p.evaluate(() => document.querySelector('#lobby-code b')?.textContent ?? '')
const rosterNames = (p: Page): Promise<string[]> =>
  p.evaluate(() => [...document.querySelectorAll('.lobby-name')].map((e) => e.textContent ?? ''))
const running = (p: Page): Promise<void> =>
  p.waitForFunction(() => document.documentElement.dataset.game === 'running', null, { timeout: 30_000 }).then(() => {})
const settle = (p: Page, ms = 700): Promise<void> => p.waitForTimeout(ms)

let server: ChildProcess | undefined
let preview: ChildProcess | undefined
let browser: Browser | undefined

try {
  server = spawn(process.execPath, ['Echo-Tag-Server/src/index.ts'], {
    env: { ...process.env, PORT: String(WS_PORT) },
    stdio: 'ignore',
  })
  preview = spawn('npx', ['vite', 'preview', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: 'Echo-Tag-Frontend',
    stdio: 'ignore',
  })
  await Promise.all([waitPort(URL), waitPort(`http://127.0.0.1:${WS_PORT}/`)])
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  const open = async (cfg: StubCfg): Promise<Page> => {
    const ctx = await browser!.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await ctx.newPage()
    page.on('dialog', (d) => void d.dismiss()) // the invite button falls back to prompt() when the clipboard is blocked
    // Surface page-side failures in the run log: a silent exception here is a failed check later.
    page.on('pageerror', (e) => console.log(`    [page error] ${String(e).slice(0, 300)}`))
    page.on('console', (m) => {
      // The dev build still carries the Poki tag, whose SDK grumbles off-domain; that noise
      // and the http-only COOP notice are not ours.
      const t = m.text()
      if (m.type() === 'error' && !/poki|Cross-Origin-Opener-Policy|ERR_FAILED/.test(t)) console.log(`    [console.error] ${t.slice(0, 300)}`)
    })
    await page.addInitScript(stubSdk(cfg))
    await page.goto(URL)
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'ready')
    return page
  }

  // ── A: party leader — instant multiplayer, signed in ──
  console.log('instant multiplayer (party leader)')
  const A = await open({ instant: true, user: { username: 'GhostHunter_1' } })
  await running(A)
  await settle(A)
  let ca = await calls(A)
  ok(has(ca, 'init') && has(ca, 'loadingStart') && has(ca, 'loadingStop'), 'SDK init + loadingStart/loadingStop called')
  const codeA = await lobbyCode(A)
  ok(/^[A-Z]{5}$/.test(codeA), `landed in a private room without touching the menu (code ${codeA})`)
  let room = lastRoom(ca)
  ok(room?.roomId === codeA && room?.isJoinable === true && room?.inviteParams?.room === codeA, 'updateRoom({roomId: code, isJoinable: true, inviteParams: {room}})')
  ok((await rosterNames(A)).includes('GhostHunter_1'), 'own CrazyGames username shown in the lobby roster')
  await A.click('#lobby-invite')
  await settle(A, 300)
  ca = await calls(A)
  ok(ca.some((c) => c[0] === 'inviteLink' && (c[1] as { room?: string })?.room === codeA), 'COPY INVITE LINK builds the link through SDK.game.inviteLink')

  // ── B: friend arriving from an invite (params present at load) ──
  console.log('friend joins via invite params')
  const B = await open({ invite: { room: codeA }, user: { username: 'Friend_2' } })
  await running(B)
  await settle(B)
  ok((await lobbyCode(B)) === codeA, 'invite params at load put the friend straight into the same room')
  ok((await rosterNames(A)).includes('Friend_2'), "host's roster shows the friend's username")
  ok((await rosterNames(B)).includes('GhostHunter_1'), "friend's roster shows the host's username")

  // ── settings: chat disable/enable live ──
  console.log('settings listener')
  ok((await B.$('#chat-btn')) !== null, 'chat is mounted while settings allow it')
  await B.evaluate(() => (globalThis as { __cgFire: { settings(s: unknown): void } }).__cgFire.settings({ disableChat: true, muteAudio: true }))
  await settle(B, 300)
  ok((await B.$('#chat-btn')) === null, 'settings.disableChat=true removes the chat UI')
  await B.evaluate(() => (globalThis as { __cgFire: { settings(s: unknown): void } }).__cgFire.settings({ disableChat: false, muteAudio: false }))
  await settle(B, 600)
  ok((await B.$('#chat-btn')) !== null, 'settings.disableChat=false brings the chat UI back')

  // ── C: already in quick match, then accepts an invite → in-place room switch ──
  console.log('join listener while already playing')
  const C = await open({ user: { username: 'LateFriend_3' } })
  await C.click('#quick')
  await running(C)
  await settle(C)
  let cc = await calls(C)
  const pub = lastRoom(cc)
  ok(!!pub && pub.isJoinable === true && typeof pub.inviteParams?.rid === 'string', 'quick-match room reported joinable by id (inviteParams.rid)')
  await C.evaluate(() => {
    ;(globalThis as { __marker?: number }).__marker = 42 // survives only if the page does not reload
  })
  await C.evaluate((code) => (globalThis as { __cgFire: { join(p: unknown): void } }).__cgFire.join({ room: code }), codeA)
  await C.waitForFunction((code) => document.querySelector('#lobby-code b')?.textContent === code, codeA, { timeout: 30_000 })
  await settle(C)
  ok((await C.evaluate(() => (globalThis as { __marker?: number }).__marker)) === 42, 'join listener switched rooms WITHOUT a page reload')
  cc = await calls(C)
  ok(has(cc, 'leftRoom'), 'leftRoom() fired for the room being left')
  ok(lastRoom(cc)?.roomId === codeA, 'updateRoom now reports the new room')
  ok((await rosterNames(A)).includes('LateFriend_3'), "host's roster shows the late friend")

  // ── gameplay: host starts, first input fires gameplayStart ──
  console.log('gameplay events')
  await A.click('#lobby-start')
  await A.waitForFunction(() => (globalThis as { __echoTag?: { phase: number } }).__echoTag?.phase === 2, null, { timeout: 20_000 })
  await A.keyboard.down('ArrowRight')
  await settle(A, 400)
  await A.keyboard.up('ArrowRight')
  ca = await calls(A)
  ok(has(ca, 'gameplayStart'), 'gameplayStart on the first in-round input')

  // ── D: SDK present but environment 'disabled' (self-hosted copy) ──
  console.log("environment 'disabled'")
  const D = await open({ env: 'disabled', instant: true, invite: { room: codeA } })
  await settle(D, 800)
  ok((await D.evaluate(() => document.documentElement.dataset.game)) === undefined, 'no auto-start: SDK flags ignored when the SDK refuses the domain')
  await D.click('#play')
  await running(D)
  const cd = await calls(D)
  ok(cd.filter((c) => c[0] !== 'init').length === 0, 'no SDK calls made after init on a disabled environment')
} finally {
  await browser?.close()
  preview?.kill('SIGTERM')
  server?.kill('SIGTERM')
}

if (failures.length > 0) {
  console.error(`\n${failures.length} CrazyGames check(s) failed`)
  process.exit(1)
}
console.log('\nCrazyGames integration: all checks passed')
