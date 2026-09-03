import { Server } from '@colyseus/core'
import { uWebSocketsTransport } from '@colyseus/uwebsockets-transport'
import { ArenaRoom } from './rooms/ArenaRoom.ts'
import { env } from './config/env.ts'

/**
 * Server entry. Deliberately minimal: one room type, uWebSockets transport, no
 * express app — the game is served by Vite/Poki, this process only does rooms.
 *
 * uWS over the default ws transport: same Colyseus API on both ends (clients see no
 * difference), but the C++ WebSocket core costs measurably less per message — the
 * 100-room / 1200-player load in tools/stress measured ~25% less CPU (~22% vs ~30% of
 * a core) and ~15% less RSS than the ws transport, back to back on the same machine.
 * Byte-level flood throttling still belongs in the TLS proxy in front.
 *
 * `filterBy(['code', 'map'])` splits matchmaking into pools by two join options: `code`
 * ('' for quick match; a host creates with a fresh 5-letter code and friends join with the
 * same one) and `map` (quick match only — the arena picked on the boot menu, so public
 * rooms are per map). Privacy comes from the pool split alone, NOT setPrivate(): that would
 * hide a private room from friends joining by code too. A join that names a filter field a
 * room's listing lacks never matches — so code joins must not send `map`.
 */
const server = new Server({
  transport: new uWebSocketsTransport(),
})

server.define('arena', ArenaRoom).filterBy(['code', 'map'])

await server.listen(env.port)
console.log(`echo-tag server listening on :${env.port}`)
