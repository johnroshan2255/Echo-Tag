/**
 * Room-chat profanity filter — the minimum moderation CrazyGames (and most portals)
 * require before a game with chat goes live. Runs on the server before every relay so
 * no client ever receives an unfiltered line (the sender sees the broadcast too, so
 * everyone in the room sees the same masked text).
 *
 * Approach: token-wise matching on a normalised copy of the text. Normalisation folds
 * case, common leetspeak substitutions (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s) and
 * strips separators inside a word ("s.h.i.t", "f_u_c_k"), then checks two spellings:
 * runs of the same letter capped at two ("ass", "boobs" survive) and fully collapsed
 * ("fuuuck" → "fuck"). A matched token is replaced, character for character, with
 * asterisks in the ORIGINAL text so lengths and layout are preserved.
 *
 * Whole-token matching avoids the classic false positives (Scunthorpe, assassin,
 * classic); a small set of slurs is additionally matched as a substring because they
 * have no innocent host words worth protecting.
 */

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't',
}

// Whole-word matches (after normalisation). Plural / -ing / -er / -ed forms are covered
// by the suffix loop in matchesWord, so list stems only.
const WORDS = new Set<string>([
  'fuck', 'fuk', 'fck', 'fucker', 'motherfucker', 'shit', 'shite', 'bullshit', 'bitch', 'ass',
  'asshole', 'arse', 'arsehole', 'bastard', 'cunt', 'dick', 'dickhead', 'cock', 'cocksucker',
  'pussy', 'twat', 'wanker', 'whore', 'slut', 'prick', 'piss', 'crap', 'damn', 'dumbass',
  'jackass', 'douche', 'douchebag', 'bollocks', 'tits', 'boobs', 'penis', 'vagina', 'porn',
  'porno', 'rape', 'rapist', 'nazi', 'hitler', 'retard', 'retarded', 'spastic', 'fag',
  'faggot', 'dyke', 'tranny', 'kys', 'stfu', 'wtf', 'gtfo', 'lmfao',
])

// Substring matches (after normalisation): slurs with no innocent host word.
const SUBSTRINGS: readonly string[] = ['nigg', 'faggot', 'chink', 'kike', 'wetback']

const SUFFIXES = ['', 's', 'es', 'ing', 'in', 'er', 'ers', 'ed', 'y']

const normaliseChar = (c: string): string => LEET[c] ?? c

/**
 * Fold one raw token to comparable forms: lower-case, de-leet, letters only. Returns
 * [runs capped at 2, fully collapsed] — see the header comment for why both.
 */
// Sentence punctuation hugging a token ("shit!", "(fuck)") is stripped before leet
// folding so a trailing "!" is read as punctuation, not as the letter i.
const EDGE_PUNCT = /^[.,;:?!'"()[\]{}…-]+|[.,;:?!'"()[\]{}…-]+$/gu

const normaliseToken = (raw: string): [string, string] => {
  let capped = ''
  let collapsed = ''
  let prev = ''
  let run = 0
  for (const ch of raw.toLowerCase().replace(EDGE_PUNCT, '')) {
    const c = normaliseChar(ch)
    if (c < 'a' || c > 'z') continue
    if (c === prev) {
      run++
      if (run < 2) capped += c
      continue
    }
    run = 0
    prev = c
    capped += c
    collapsed += c
  }
  return [capped, collapsed]
}

const inWords = (norm: string): boolean => {
  for (const s of SUFFIXES) {
    if (s.length > 0 && !norm.endsWith(s)) continue
    const stem = s.length > 0 ? norm.slice(0, -s.length) : norm
    if (stem.length >= 3 && WORDS.has(stem)) return true
  }
  return false
}

const matchesWord = ([capped, collapsed]: [string, string]): boolean =>
  inWords(capped) || inWords(collapsed)

const matchesSubstring = ([capped, collapsed]: [string, string]): boolean => {
  for (const s of SUBSTRINGS) if (capped.includes(s) || collapsed.includes(s)) return true
  return false
}

/** True if the token (or the whole line) contains something the filter would mask. */
export const isProfane = (text: string): boolean => {
  if (matchesSubstring(normaliseToken(text))) return true
  for (const tok of text.split(/\s+/)) {
    if (tok.length === 0) continue
    const norm = normaliseToken(tok)
    if (norm[0].length === 0) continue
    if (matchesWord(norm) || matchesSubstring(norm)) return true
  }
  return false
}

/**
 * Mask profanity in a chat line. Returns the input unchanged when clean (same string
 * reference — cheap to check on the hot path). Whitespace-separated tokens are matched
 * individually; a matched token becomes a run of '*' of the same length.
 */
export const filterProfanity = (text: string): string => {
  const parts = text.split(/(\s+)/)
  let changed = false
  for (let i = 0; i < parts.length; i += 2) {
    const tok = parts[i]!
    if (tok.length === 0) continue
    const norm = normaliseToken(tok)
    if (norm[0].length === 0) continue
    if (!matchesWord(norm) && !matchesSubstring(norm)) continue
    parts[i] = '*'.repeat(tok.length)
    changed = true
  }
  if (changed) return parts.join('')
  // Last resort: a slur split across spaces ("n i g g e r") — mask the whole line.
  if (matchesSubstring(normaliseToken(text))) return text.replace(/\S/g, '*')
  return text
}
