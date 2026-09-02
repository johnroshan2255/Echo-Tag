import { pokiCommercialBreak, pokiGameplayStart, pokiGameplayStop, pokiInit, pokiLoadingFinished } from './poki.ts'
import { cgGameplayStart, cgGameplayStop, cgInit, cgLoadingFinished, cgMidgameAd } from './crazygames.ts'

/**
 * The portal-neutral surface the game talks to: one set of lifecycle calls, dispatched to
 * whichever SDK the build shipped (index.html carries one script tag per package — see
 * tools/package). Both facades are no-ops when their SDK is absent, so calling both is
 * free and keeps this file trivially small for the boot budget.
 */

/** Which portal is embedding us: only true INSIDE their player page (iframe), never on a
 * self-hosted copy that merely loaded the SDK script. */
export const underPortal = (): boolean =>
  globalThis.self !== globalThis.top && ('PokiSDK' in globalThis || 'CrazyGames' in globalThis)

export const portalInit = async (): Promise<void> => {
  await Promise.all([pokiInit(), cgInit()])
}

export const portalLoadingFinished = (): void => {
  pokiLoadingFinished()
  cgLoadingFinished()
}

export const portalGameplayStart = (): void => {
  pokiGameplayStart()
  cgGameplayStart()
}

export const portalGameplayStop = (): void => {
  pokiGameplayStop()
  cgGameplayStop()
}

/** Between-rounds ad slot on whichever portal we are on; audio muted for its duration. */
export const portalAdBreak = async (mute: () => void, unmute: () => void): Promise<void> => {
  await pokiCommercialBreak(mute, unmute)
  await cgMidgameAd(mute, unmute)
}
