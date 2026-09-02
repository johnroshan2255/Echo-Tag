import { pokiCommercialBreak, pokiGameplayStart, pokiGameplayStop } from './poki.ts'
import { cgActive, cgGameplayStart, cgGameplayStop, cgMidgameAd } from './crazygames.ts'

/**
 * The portal-neutral surface the game talks to: one set of lifecycle calls, dispatched to
 * whichever SDK the build shipped (index.html carries one script tag per package — see
 * tools/package). Both facades are no-ops when their SDK is absent, so calling both is
 * free and keeps this file trivially small for the boot budget.
 *
 * Init is deliberately NOT here: each SDK is initialised on its own in boot/main.ts, so a
 * slow or absent one never delays the other's hooks (an invite arriving while Poki's init
 * was still pending used to be lost).
 */

/** Which portal is embedding us: only true INSIDE their player page (iframe), never on a
 * self-hosted copy that merely loaded the SDK script. */
export const underPortal = (): boolean =>
  globalThis.self !== globalThis.top && ('PokiSDK' in globalThis || 'CrazyGames' in globalThis)

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
  // One slot, not two: on localhost BOTH SDKs run in their dev modes (the dev build carries
  // both tags), and a shipped zip has exactly one — so pick CrazyGames when it is live.
  if (cgActive()) await cgMidgameAd(mute, unmute)
  else await pokiCommercialBreak(mute, unmute)
}
