/**
 * The CrazyGames SDK (v3) facade — every touchpoint their requirements list, guarded so
 * the game behaves identically when the SDK is absent (Poki build, itch, local dev, CI).
 *
 * What review checks (docs.crazygames.com/requirements + /sdk):
 *   - init() before anything else; loadingStart/Stop around the load; gameplayStart on
 *     play, gameplayStop when play pauses (round over, tab hidden, ad running).
 *   - "Online with Friends": updateRoom({roomId, isJoinable, inviteParams}) whenever the
 *     player is in a room, leftRoom() on leave, inviteParams honoured on load AND via the
 *     join listener while already playing, isInstantMultiplayer → straight into a
 *     joinable room, usernames shown in-game.
 *   - settings.muteAudio / settings.disableChat honoured live.
 *   - midgame ads between rounds, audio muted for their duration.
 *
 * Outside crazygames.com and localhost the SDK reports environment 'disabled' and every
 * call THROWS — so the facade treats that as "no SDK" and every method below is a no-op.
 * The script tag is async: init polls briefly for the global.
 */

type Params = Record<string, string>
interface CGSettings {
  muteAudio?: boolean
  disableChat?: boolean
}
interface CGSdk {
  init(): Promise<void>
  environment: 'local' | 'crazygames' | 'disabled'
  game: {
    gameplayStart(): void
    gameplayStop(): void
    loadingStart(): void
    loadingStop(): void
    happytime(): void
    isInstantMultiplayer: boolean
    inviteParams: Params | null
    inviteLink(params: Params): string
    updateRoom(o: { roomId: string; isJoinable: boolean; inviteParams?: Params }): void
    leftRoom(): void
    addJoinRoomListener(cb: (params: Params) => void): void
    settings: CGSettings
    addSettingsChangeListener(cb: (s: CGSettings) => void): void
    removeSettingsChangeListener(cb: (s: CGSettings) => void): void
  }
  ad: {
    requestAd(type: 'midgame' | 'rewarded', cb: { adStarted?(): void; adFinished?(): void; adError?(e: unknown): void }): void
  }
  user: {
    isUserAccountAvailable: boolean
    getUser(): Promise<{ username: string } | null>
    getUserToken(): Promise<string>
  }
}

const raw = (): CGSdk | undefined => (globalThis as { CrazyGames?: { SDK?: CGSdk } }).CrazyGames?.SDK

let live: CGSdk | null = null
let gameplayActive = false
/** The room CrazyGames currently believes we are in ('' = none) and its joinable flag. */
let currentRoomId = ''
let currentJoinable: boolean | null = null

/** True once init succeeded on a domain where the SDK actually works. */
export const cgActive = (): boolean => live !== null

/**
 * Resolves once the SDK is initialised, or after a short wait when it never shows up or
 * refuses this domain. Safe to call once per page.
 */
export const cgInit = async (): Promise<void> => {
  // No script tag (Poki/web builds): nothing is coming — return at once so the portal
  // init, and the instant-multiplayer start sequenced behind it, are not held up.
  if (!document.querySelector('script[src*="crazygames-sdk"]')) return
  for (let i = 0; i < 30 && !raw(); i++) await new Promise((r) => setTimeout(r, 150))
  const sdk = raw()
  if (!sdk) return
  try {
    await sdk.init()
    if (sdk.environment === 'disabled') return
    live = sdk
    live.game.loadingStart()
  } catch {
    /* ad blockers, foreign domains: the game must not care */
  }
}

/** Every SDK call goes through here: a throw never reaches game code. */
const call = (f: (s: CGSdk) => void): void => {
  if (!live) return
  try {
    f(live)
  } catch {
    /* see header */
  }
}

export const cgLoadingFinished = (): void => call((s) => s.game.loadingStop())

/** Idempotent — call from the input path; only the first fires per play session. */
export const cgGameplayStart = (): void => {
  if (!live || gameplayActive) return
  gameplayActive = true
  call((s) => s.game.gameplayStart())
}

export const cgGameplayStop = (): void => {
  if (!live || !gameplayActive) return
  gameplayActive = false
  call((s) => s.game.gameplayStop())
}

/** A moment worth celebrating (the local player won the round). */
export const cgHappytime = (): void => call((s) => s.game.happytime())

/**
 * Midgame ad between rounds. `mute`/`unmute` bracket it — CrazyGames requires game audio
 * silent while an ad runs. Resolves immediately when there is no SDK, no fill, or an error.
 */
export const cgMidgameAd = (mute: () => void, unmute: () => void): Promise<void> =>
  new Promise((resolve) => {
    if (!live) return resolve()
    cgGameplayStop()
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      unmute()
      resolve()
    }
    try {
      live.ad.requestAd('midgame', { adStarted: mute, adFinished: finish, adError: finish })
    } catch {
      finish()
    }
  })

// ── Online with Friends ────────────────────────────────────────────────────────

/** Invite params carried to a friend: a private room code, or a public room's id. */
export type RoomInvite = { room: string } | { rid: string }

const inviteParams = (inv: RoomInvite): Params => ('room' in inv ? { room: inv.room } : { rid: inv.rid })
const roomIdOf = (inv: RoomInvite): string => ('room' in inv ? inv.room : inv.rid)

/**
 * Tells CrazyGames where this player is and whether a friend can follow. Deduped: the
 * lobby view arrives many times a second while nothing relevant changes.
 */
export const cgUpdateRoom = (inv: RoomInvite, joinable: boolean): void => {
  const id = roomIdOf(inv)
  if (id === currentRoomId && joinable === currentJoinable) return
  currentRoomId = id
  currentJoinable = joinable
  call((s) => s.game.updateRoom({ roomId: id, isJoinable: joinable, inviteParams: inviteParams(inv) }))
}

/**
 * We left a room. A session passes the room IT was in: during an in-place room switch the
 * old session is torn down after the new one has already reported its room, and must not
 * un-report it.
 */
export const cgLeftRoom = (inv?: RoomInvite | null): void => {
  if (currentRoomId === '') return
  if (inv && roomIdOf(inv) !== currentRoomId) return
  currentRoomId = ''
  currentJoinable = null
  call((s) => s.game.leftRoom())
}

/** A crazygames.com link that opens the game straight into this room, or null. */
export const cgInviteLink = (inv: RoomInvite): string | null => {
  if (!live) return null
  try {
    return live.game.inviteLink(inviteParams(inv))
  } catch {
    return null
  }
}

const parseInvite = (p: Params | null | undefined): RoomInvite | null => {
  const room = p?.room?.toUpperCase()
  if (room && /^[A-Z]{5}$/.test(room)) return { room }
  const rid = p?.rid
  if (rid && /^[\w-]{1,32}$/.test(rid)) return { rid }
  return null
}

/** The room a friend's invite pointed at when this page loaded, if any. */
export const cgInviteAtLoad = (): RoomInvite | null => {
  if (!live) return null
  try {
    return parseInvite(live.game.inviteParams)
  } catch {
    return null
  }
}

/** Fires when the player accepts a friend's invite while already in the game. */
export const cgOnJoinRoom = (cb: (inv: RoomInvite) => void): void =>
  call((s) =>
    s.game.addJoinRoomListener((p) => {
      const inv = parseInvite(p)
      if (inv) cb(inv)
    }),
  )

/** Party leader landing from the CrazyGames "play with friends" flow: skip the menu. */
export const cgInstantMultiplayer = (): boolean => {
  if (!live) return false
  try {
    return live.game.isInstantMultiplayer === true
  } catch {
    return false
  }
}

// ── Settings & identity ────────────────────────────────────────────────────────

export const cgSettings = (): CGSettings => {
  if (!live) return {}
  try {
    return live.game.settings ?? {}
  } catch {
    return {}
  }
}

/**
 * Returns the unsubscribe — a game session must drop its listener when it is torn down
 * (the join listener swaps sessions without a page reload). One SDK listener is registered
 * lazily and fans out to a local set, so unsubscribing never depends on the SDK's API.
 */
const settingsCbs = new Set<(s: CGSettings) => void>()
let settingsHooked = false
export const cgOnSettingsChange = (cb: (s: CGSettings) => void): (() => void) => {
  if (!settingsHooked && live) {
    settingsHooked = true
    call((s) => s.game.addSettingsChangeListener((n) => settingsCbs.forEach((f) => f(n ?? {}))))
  }
  settingsCbs.add(cb)
  return () => void settingsCbs.delete(cb)
}

/**
 * The signed-in player's user token (a 1h JWT), or null. The SERVER verifies it and takes
 * the username from the claims — the client never names itself (auth/cgToken.ts).
 * Bounded: this sits on the path to the room connect, and a name is nice-to-have.
 */
export const cgUserToken = async (): Promise<string | null> => {
  if (!live) return null
  try {
    if (!live.user.isUserAccountAvailable) return null
    const t = await Promise.race([live.user.getUserToken(), new Promise<null>((r) => setTimeout(() => r(null), 1500))])
    return typeof t === 'string' && t.length > 0 ? t : null
  } catch {
    return null // not signed in (the SDK rejects), or accounts unavailable
  }
}
