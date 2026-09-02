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
  }
  ad: {
    requestAd(type: 'midgame' | 'rewarded', cb: { adStarted?(): void; adFinished?(): void; adError?(e: unknown): void }): void
  }
  user: {
    isUserAccountAvailable: boolean
    getUser(): Promise<{ username: string } | null>
  }
}

const raw = (): CGSdk | undefined => (globalThis as { CrazyGames?: { SDK?: CGSdk } }).CrazyGames?.SDK

let live: CGSdk | null = null
let gameplayActive = false
let lastRoomKey = ''

/** True once init succeeded on a domain where the SDK actually works. */
export const cgActive = (): boolean => live !== null

/**
 * Resolves once the SDK is initialised, or after a short wait when it never shows up or
 * refuses this domain. Safe to call once per page.
 */
export const cgInit = async (): Promise<void> => {
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

/**
 * Tells CrazyGames where this player is and whether a friend can follow. Deduped: the
 * lobby view arrives many times a second while nothing relevant changes.
 */
export const cgUpdateRoom = (inv: RoomInvite, joinable: boolean): void => {
  const key = `${'room' in inv ? inv.room : inv.rid}|${joinable}`
  if (key === lastRoomKey) return
  lastRoomKey = key
  call((s) =>
    s.game.updateRoom({ roomId: 'room' in inv ? inv.room : inv.rid, isJoinable: joinable, inviteParams: inviteParams(inv) }),
  )
}

export const cgLeftRoom = (): void => {
  if (lastRoomKey === '') return
  lastRoomKey = ''
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

export const cgOnSettingsChange = (cb: (s: CGSettings) => void): void =>
  call((s) => s.game.addSettingsChangeListener((n) => cb(n ?? {})))

/** The signed-in CrazyGames username, or null (not signed in, accounts off, no SDK). */
export const cgUsername = async (): Promise<string | null> => {
  if (!live) return null
  try {
    if (!live.user.isUserAccountAvailable) return null
    const u = await live.user.getUser()
    return u?.username ?? null
  } catch {
    return null
  }
}
