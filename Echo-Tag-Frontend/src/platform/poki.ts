/**
 * The Poki SDK facade — every touchpoint the platform requires, guarded so the game is
 * byte-identical in behaviour when the SDK is absent (local dev, CI, self-hosting).
 *
 * The contract that matters for review (tech doc §6):
 *   - init() as early as possible; gameLoadingFinished() the moment the menu is usable.
 *   - gameplayStart() on the player's FIRST INPUT of a play session — never on load.
 *   - gameplayStop() when play pauses: round over, tab hidden.
 *   - commercialBreak() between rounds, with audio muted for its duration.
 *
 * The SDK arrives via an async script tag, so it may land after boot — init polls briefly.
 */

interface PokiSDKType {
  init(): Promise<void>
  gameLoadingFinished(): void
  gameplayStart(): void
  gameplayStop(): void
  commercialBreak(onStart?: () => void): Promise<void>
}

const sdk = (): PokiSDKType | undefined =>
  (globalThis as { PokiSDK?: PokiSDKType }).PokiSDK

let initialised = false
let gameplayActive = false

/** Resolves once the SDK is initialised, or after a short wait when it never shows up. */
export const pokiInit = async (): Promise<void> => {
  // No script tag, no SDK coming: bail at once rather than holding the portal init (and
  // everything sequenced behind it) for the full poll window.
  if (!document.querySelector('script[src*="poki-sdk"]')) return
  for (let i = 0; i < 30 && !sdk(); i++) {
    await new Promise((r) => setTimeout(r, 150))
  }
  try {
    await sdk()?.init()
    initialised = true
  } catch {
    // Ad blockers and dev machines land here; the game must not care.
  }
}

export const pokiLoadingFinished = (): void => {
  if (initialised) sdk()?.gameLoadingFinished()
}

/** Idempotent — call freely from the input path; only the first fires per session. */
export const pokiGameplayStart = (): void => {
  if (!initialised || gameplayActive) return
  gameplayActive = true
  sdk()?.gameplayStart()
}

export const pokiGameplayStop = (): void => {
  if (!initialised || !gameplayActive) return
  gameplayActive = false
  sdk()?.gameplayStop()
}

/**
 * Runs an ad break between rounds. `mute`/`unmute` bracket the whole thing — Poki requires
 * game audio silent during ads. Resolves immediately when there is no SDK or no fill.
 */
export const pokiCommercialBreak = async (mute: () => void, unmute: () => void): Promise<void> => {
  if (!initialised) return
  pokiGameplayStop()
  mute()
  try {
    await sdk()?.commercialBreak(mute)
  } finally {
    unmute()
  }
}
