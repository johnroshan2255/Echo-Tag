/**
 * Message names on the Colyseus wire. Single characters: they ride in every packet.
 *
 *   client → server
 *     'i'  input frame        [seq u16, packed u8]
 *     'u'  use tool           [inventory slot u8] — deploys at the sender's feet
 *     'c'  chat               a short text line; relayed to the room, never stored
 *     'n'  bot count          host sets how many bots join at round start (private rooms)
 *     'g'  host pressed start (private lobbies only)
 *
 *   server → client
 *     'w'  welcome            your slot + round setup + full echo history (once per join)
 *     'r'  round setup        map/keys/colors for a new round (start or rotation)
 *     's'  snapshot           the 20Hz hot state — see encode.ts
 *
 * Cold, slow state (lobby roster, phase, host, scores) rides Colyseus Schema instead;
 * this channel is only for what changes every tick or must arrive exactly once.
 */
export const MSG = {
  Input: 'i',
  Use: 'u',
  Chat: 'c',
  Bots: 'n',
  Go: 'g',
  Welcome: 'w',
  Round: 'r',
  Snapshot: 's',
} as const
