import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { ArenaRoom } from './rooms/ArenaRoom.ts'
import { env } from './config/env.ts'

/**
 * Server entry. Deliberately minimal: one room type, default WebSocket transport, no
 * express app — the game is served by Vite/Poki, this process only does rooms.
 *
 * `filterBy(['code'])` splits matchmaking into pools by the `code` join option:
 * quick-match clients all pass '' and share public rooms; a host creates with a fresh
 * 5-letter code and friends join with the same one. Private rooms additionally call
 * setPrivate, so they are invisible to everyone without the code.
 */
const server = new Server({
  transport: new WebSocketTransport(),
})

server.define('arena', ArenaRoom).filterBy(['code'])

await server.listen(env.port)
console.log(`echo-tag server listening on :${env.port}`)
