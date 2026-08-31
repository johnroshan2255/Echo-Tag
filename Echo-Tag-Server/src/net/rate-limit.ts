// Echo-Tag-Server/src/net/rate-limit.ts
// Per-client message rate caps live where the messages land:
//   - MSG.Input: INPUT_MSGS_PER_TICK_MAX in rooms/ArenaRoom.ts — a per-slot budget reset
//     each 50ms tick; excess messages are dropped after one counter check.
//   - MSG.Chat / MSG.Emote: CHAT_MIN_INTERVAL_MS / EMOTE_MIN_INTERVAL_MS wall-clock gates
//     in the same file.
// Note: these caps bound handler work, not socket decode — a determined flood still costs
// msgpack parsing. Byte-level throttling belongs in the TLS proxy in front of the server.
export {}
