import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { verifyCgToken } from './cgToken.ts'

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = publicKey.export({ type: 'pkcs1', format: 'pem' }) as string // CrazyGames publishes PKCS#1 ("BEGIN RSA PUBLIC KEY")
const sign = (payload: object, alg = 'RS256'): string => {
  const body = `${b64({ alg, typ: 'JWT' })}.${b64(payload)}`
  const s = createSign('RSA-SHA256')
  s.update(body)
  return `${body}.${s.sign(privateKey).toString('base64url')}`
}
const now = 1_700_000_000_000
const good = { userId: 'u1', gameId: 'g', username: 'GhostHunter_1', profilePictureUrl: '', iat: now / 1000, exp: now / 1000 + 3600 }

describe('CrazyGames token verification', () => {
  it('accepts a valid RS256 token and returns the username', () => {
    assert.deepEqual(verifyCgToken(sign(good), pem, now)?.username, 'GhostHunter_1')
  })
  it('rejects an expired token', () => {
    assert.equal(verifyCgToken(sign({ ...good, exp: now / 1000 - 1 }), pem, now), null)
  })
  it('rejects a tampered payload', () => {
    const t = sign(good).split('.')
    t[1] = b64({ ...good, username: 'Admin' })
    assert.equal(verifyCgToken(t.join('.'), pem, now), null)
  })
  it('rejects the wrong key, a non-RS256 header, and garbage', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'pkcs1', format: 'pem' }) as string
    assert.equal(verifyCgToken(sign(good), other, now), null)
    assert.equal(verifyCgToken(sign(good, 'none'), pem, now), null)
    assert.equal(verifyCgToken('not.a.jwt', pem, now), null)
    assert.equal(verifyCgToken('', pem, now), null)
  })
})
