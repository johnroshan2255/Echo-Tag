import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterProfanity, isProfane } from './profanity.ts'

describe('chat profanity filter', () => {
  it('leaves clean lines untouched (same reference)', () => {
    for (const s of ['gg everyone', 'run to the wardrobe!', 'the ghost is behind you', 'lol nice 2:57'])
      assert.equal(filterProfanity(s), s)
  })

  it('masks whole words and keeps layout', () => {
    assert.equal(filterProfanity('what the fuck'), 'what the ****')
    assert.equal(filterProfanity('you SHIT!'), 'you *****')
    assert.equal(filterProfanity('bitches'), '*******')
    assert.equal(filterProfanity('kiss my ass'), 'kiss my ***')
    assert.equal(filterProfanity('kys noob'), '*** noob')
  })

  it('sees through leetspeak, separators and stretched letters', () => {
    assert.ok(isProfane('sh1t'))
    assert.ok(isProfane('f.u.c.k'))
    assert.ok(isProfane('fuuuuck'))
    assert.ok(isProfane('a$$hole'))
    assert.equal(filterProfanity('$h!t happens'), '**** happens')
  })

  it('does not trip on innocent host words', () => {
    for (const s of ['Scunthorpe', 'assassin', 'classic', 'bass', 'grass', 'hello', 'cockpit', 'shitake', 'spicy', 'auspicious'])
      assert.equal(isProfane(s), false, s)
  })

  it('masks slurs even when embedded or spaced out', () => {
    assert.equal(isProfane('xxniggerxx'), true)
    assert.equal(filterProfanity('n i g g e r'), '* * * * * *')
  })
})
