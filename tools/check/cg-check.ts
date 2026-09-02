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
import { createSign, generateKeyPairSync } from 'node:crypto'
import { chromium, type Browser, type Page } from 'playwright'
import { Client } from '@colyseus/sdk'

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
  /** Signed-in user: the stub hands out a JWT for this name, signed with the check's own key. */
  user?: { username: string } | null
}

// The server derives usernames from VERIFIED CrazyGames tokens only. The check signs its
// own RS256 tokens and hands the server the matching public key (CG_JWT_PUBLIC_KEY).
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PUBLIC_PEM = publicKey.export({ type: 'pkcs1', format: 'pem' }) as string
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
const tokenFor = (username: string, exp = Math.floor(Date.now() / 1000) + 3600): string => {
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ userId: `id-${username}`, gameId: 'echo-tag', username, profilePictureUrl: '', iat: exp - 3600, exp })}`
  const sg = createSign('RSA-SHA256')
  sg.update(body)
  return `${body}.${sg.sign(privateKey).toString('base64url')}`
}

/** Installs window.CrazyGames.SDK before any game script runs; records every call. */
const stubSdk = (cfg: StubCfg, token: string | null): string => `
  (() => {
    const cfg = ${JSON.stringify(cfg)}; const token = ${JSON.stringify(token)};
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
        removeSettingsChangeListener: (cb) => { const i = settingsCbs.indexOf(cb); if (i >= 0) settingsCbs.splice(i, 1) },
      },
      ad: { requestAd: (t, cb) => { calls.push(['requestAd', t]); cb.adStarted?.(); setTimeout(() => cb.adFinished?.(), 30) } },
      user: { isUserAccountAvailable: true, getUser: async () => cfg.user ?? null,
        getUserToken: async () => { if (!token) throw new Error('userNotAuthenticated'); return token } },
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
    env: { ...process.env, PORT: String(WS_PORT), CG_JWT_PUBLIC_KEY: PUBLIC_PEM },
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
      // (521 is the matchmaker refusing the deliberately stale invite below.)
      if (m.type() === 'error' && !/poki|Cross-Origin-Opener-Policy|ERR_FAILED|status of 521/.test(t)) console.log(`    [console.error] ${t.slice(0, 300)}`)
    })
    await page.addInitScript(stubSdk(cfg, cfg.user ? tokenFor(cfg.user.username) : null))
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
  ok(ca.some((c) => c[0] === 'inviteLink' && (c[1] as { room?: string })?.room === codeA), 'inviteLink() fires automatically on private-lobby open (CrazyGames auto-detects it)')
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
  // Poll with a state dump on failure: a stall here has been intermittent, and the dump
  // (marker, lobby codes, canvases, last SDK calls) is what tells the two causes apart.
  let switched = false
  for (let i = 0; i < 30 && !switched; i++) {
    await settle(C, 1000)
    switched = (await C.evaluate(() => document.querySelector('#lobby-code b')?.textContent)) === codeA
  }
  if (!switched) {
    const st = await C.evaluate(() => ({
      game: document.documentElement.dataset.game,
      marker: (globalThis as { __marker?: number }).__marker,
      codes: [...document.querySelectorAll('#lobby-code b')].map((e) => e.textContent),
      stages: document.querySelectorAll('#stage').length,
      lobbies: document.querySelectorAll('#lobby').length,
      url: location.search,
    }))
    console.log('    state:', JSON.stringify(st), 'last calls:', JSON.stringify((await calls(C)).slice(-4)))
  }
  ok(switched, 'join listener moved the player into the invited room')
  ok((await C.evaluate(() => (globalThis as { __marker?: number }).__marker)) === 42, 'join listener switched rooms WITHOUT a page reload')
  cc = await calls(C)
  const roomCalls = cc.filter((c) => c[0] === 'updateRoom' || c[0] === 'leftRoom')
  ok(roomCalls.at(-1)?.[0] === 'updateRoom' && lastRoom(cc)?.roomId === codeA, 'updateRoom reports the new room, and the old session did not un-report it afterwards')
  ok((await rosterNames(A)).includes('LateFriend_3'), "host's roster shows the late friend")
  // The dead session's settings listener must be gone: toggling now must affect only the
  // live session (chat off → on again), with no errors from the torn-down one.
  await C.evaluate(() => (globalThis as { __cgFire: { settings(s: unknown): void } }).__cgFire.settings({ disableChat: true }))
  await settle(C, 300)
  ok((await C.$('#chat-btn')) === null, 'after the switch, settings.disableChat still reaches the live session')
  await C.evaluate(() => (globalThis as { __cgFire: { settings(s: unknown): void } }).__cgFire.settings({ disableChat: false }))
  await settle(C, 600)
  ok((await C.$$('#chat-btn')).length === 1, 'exactly one chat UI after re-enable (no zombie session listener)')
  ok((await C.evaluate(() => location.search)) === `?room=${codeA}`, 'URL now carries the new room code (stale ?room cleared/replaced)')

  // ── stale invite: the switch fails, the current session survives with a notice ──
  console.log('failed invite keeps the current session')
  await C.evaluate(() => (globalThis as { __cgFire: { join(p: unknown): void } }).__cgFire.join({ room: 'ZZZZQ' }))
  await settle(C, 2500)
  ok((await C.evaluate(() => (globalThis as { __marker?: number }).__marker)) === 42, 'no reload on a failed invite')
  ok((await lobbyCode(C)) === codeA, 'still in the previous room')
  ok((await C.evaluate(() => [...document.querySelectorAll('p')].some((p) => /no room|room is full/i.test(p.textContent ?? '')))), 'in-game notice shown for the bad invite')
  await C.click('button.bv-a:has-text("OK")')

  // ── server: private rooms reject id-joins without the code; names need a valid token ──
  console.log('server guards')
  const nodeClient = new Client(`ws://127.0.0.1:${WS_PORT}`)
  const priv = await nodeClient.create('arena', { code: 'QWERT' })
  let intruder: unknown = null
  try {
    await nodeClient.joinById(priv.roomId, { code: '' })
    intruder = 'joined'
  } catch (e) {
    intruder = e
  }
  ok(intruder !== 'joined', 'joinById into a private room without its code is refused')
  const forged = tokenFor('Impostor').replace(/\.[^.]+$/, '.AAAA') // signature stripped
  const spoof = await nodeClient.joinOrCreate('arena', { code: '', cgToken: forged })
  await new Promise((r) => setTimeout(r, 400))
  const spoofName = (spoof.state as unknown as { players: { get(k: string): { name: string } | undefined } }).players.get(spoof.sessionId)?.name
  ok(spoofName === '', 'a forged token yields no username')
  const expired = await nodeClient.joinOrCreate('arena', { code: '', cgToken: tokenFor('OldToken', Math.floor(Date.now() / 1000) - 10) })
  await new Promise((r) => setTimeout(r, 400))
  ok((expired.state as unknown as { players: { get(k: string): { name: string } | undefined } }).players.get(expired.sessionId)?.name === '', 'an expired token yields no username')
  await Promise.all([priv.leave(), spoof.leave(), expired.leave()])

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
