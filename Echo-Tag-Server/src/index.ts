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
 * `filterBy(['code'])` splits matchmaking into pools by the `code` join option:
 * quick-match clients all pass '' and share public rooms; a host creates with a fresh
 * 5-letter code and friends join with the same one. Private rooms additionally call
 * setPrivate, so they are invisible to everyone without the code.
 */
const server = new Server({
  transport: new uWebSocketsTransport(),
})

server.define('arena', ArenaRoom).filterBy(['code'])

await server.listen(env.port)
console.log(`echo-tag server listening on :${env.port}`)
