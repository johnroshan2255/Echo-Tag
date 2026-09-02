import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto'
import { env } from '../config/env.ts'

/**
 * CrazyGames user tokens — the ONLY source of a display name.
 *
 * The client never sends a username. It sends the JWT from `SDK.user.getUserToken()`
 * (RS256, 1h lifetime; claims: userId, gameId, username, profilePictureUrl, iat, exp) and
 * the server derives the name from the verified claims, so nobody on the shared server can
 * label themselves as somebody else's CrazyGames account. Verification is done with
 * node:crypto directly — no JWT dependency for a 40-line check.
 *
 * The public key is published at https://sdk.crazygames.com/publicKey.json and "may
 * change", so it is re-fetched on a short cache and once more on a signature miss.
 * `CG_JWT_PUBLIC_KEY` (PEM) overrides the fetch — the e2e check signs with its own pair.
 */

export interface CgClaims {
  userId: string
  username: string
  exp: number
}

const KEY_URL = 'https://sdk.crazygames.com/publicKey.json'
const KEY_TTL_MS = 10 * 60_000
const B64 = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/** Pure: verifies signature + expiry against one PEM. Exported for the unit test. */
export const verifyCgToken = (token: string, publicKeyPem: string, nowMs = Date.now()): CgClaims | null => {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, sig] = parts as [string, string, string]
  let key: KeyObject
  try {
    key = createPublicKey(publicKeyPem)
  } catch {
    return null
  }
  try {
    const header = JSON.parse(B64(h).toString('utf8')) as { alg?: string }
    if (header.alg !== 'RS256') return null
    if (!cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, B64(sig))) return null
    const claims = JSON.parse(B64(p).toString('utf8')) as Partial<CgClaims>
    if (typeof claims.username !== 'string' || typeof claims.exp !== 'number') return null
    if (claims.exp * 1000 <= nowMs) return null
    return { userId: String(claims.userId ?? ''), username: claims.username, exp: claims.exp }
  } catch {
    return null
  }
}

let cachedPem: string | null = null
let cachedAt = 0

const fetchPem = async (force = false): Promise<string | null> => {
  if (env.cgJwtPublicKey) return env.cgJwtPublicKey
  if (!force && cachedPem && Date.now() - cachedAt < KEY_TTL_MS) return cachedPem
  try {
    const res = await fetch(KEY_URL, { signal: AbortSignal.timeout(3000) })
    const json = (await res.json()) as { publicKey?: string }
    if (typeof json.publicKey !== 'string') return cachedPem
    cachedPem = json.publicKey
    cachedAt = Date.now()
  } catch {
    /* keep whatever we had; a missing key just means no names this join */
  }
  return cachedPem
}

/** Username from a token, or '' — never throws, never trusts the client's own words. */
export const usernameFromToken = async (token: unknown): Promise<string> => {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return ''
  let pem = await fetchPem()
  let claims = pem ? verifyCgToken(token, pem) : null
  if (!claims && pem && !env.cgJwtPublicKey) {
    // The key may have rotated under our cache: one forced refresh, then give up.
    pem = await fetchPem(true)
    claims = pem ? verifyCgToken(token, pem) : null
  }
  return claims?.username ?? ''
}
