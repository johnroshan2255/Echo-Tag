// Room-leak regression harness. Boots the real ArenaRoom on :2599 with create/dispose
// accounting and logs live room count + memory every 2s while tools/stress/client.mjs
// hammers it. Not part of any build; run manually:
//
//   node --expose-gc tools/stress/server.mjs     # terminal 1
//   node tools/stress/client.mjs                 # terminal 2
//
// Pass: every wave ends with live=0, created === disposed, and heap plateaus across
// waves instead of growing with the room count.
import { Server } from '@colyseus/core'
import { uWebSocketsTransport } from '@colyseus/uwebsockets-transport'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { ArenaRoom } from '../../Echo-Tag-Server/src/rooms/ArenaRoom.ts'

let live = 0
let created = 0
let disposed = 0

class StressRoom extends ArenaRoom {
  onCreate(options) {
    live++
    created++
    console.log(`room+ live=${live} created=${created}`)
    return super.onCreate(options)
  }
  onDispose() {
    live--
    disposed++
    console.log(`room- live=${live} disposed=${disposed}`)
  }
}

const server = new Server({ transport: new uWebSocketsTransport() })
server.define('arena', StressRoom).filterBy(['code'])
await server.listen(2599)
console.log('stress server ready on :2599')

// CPU% is this process's user+system time over the wall-clock window; event-loop delay
// p99 shows whether 20Hz ticks are being serviced on time (a healthy loop sits ~1ms).
const loopDelay = monitorEventLoopDelay({ resolution: 5 })
loopDelay.enable()
let lastCpu = process.cpuUsage()
let lastAt = performance.now()

setInterval(() => {
  if (globalThis.gc) globalThis.gc()
  const m = process.memoryUsage()
  const cpu = process.cpuUsage(lastCpu)
  const now = performance.now()
  const cpuPct = ((cpu.user + cpu.system) / 1000 / (now - lastAt)) * 100
  lastCpu = process.cpuUsage()
  lastAt = now
  console.log(
    `stats live=${live} created=${created} disposed=${disposed} ` +
    `rss=${(m.rss / 1048576).toFixed(1)}MB heap=${(m.heapUsed / 1048576).toFixed(1)}MB ` +
    `cpu=${cpuPct.toFixed(1)}% loop_p50=${(loopDelay.percentile(50) / 1e6).toFixed(1)}ms ` +
    `loop_p99=${(loopDelay.percentile(99) / 1e6).toFixed(1)}ms loop_max=${(loopDelay.max / 1e6).toFixed(1)}ms`,
  )
  loopDelay.reset()
}, 2000)
