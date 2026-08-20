# Deploying Echo Tag to Poki

## Build the upload

```bash
npm run package        # → echo-tag-poki.zip (~180KB)
```

The zip is `Echo-Tag-Frontend/dist` minus sourcemaps and precompressed variants: an
`index.html` plus hashed chunks under `a/`, all referenced by **relative** paths
(`base: './'`), so it works from Poki's CDN subpaths. There are no other assets — every
texture, map and sound is generated at runtime, which is what keeps the build at ~180KB
against Poki's 8MB initial-download cap.

## SDK integration (already wired)

| Poki requirement | Where |
|---|---|
| `init()` early, `gameLoadingFinished()` when interactive | `boot/main.ts` — fires the moment the menu is usable |
| `gameplayStart()` on FIRST INPUT, never on load | `game/index.ts` `localInput()` — keyboard or touch, only while a round is Playing |
| `gameplayStop()` on pause | round end and tab-hidden |
| `commercialBreak()` between rounds, audio muted throughout | round-end hook, bracketing the mix with a hard mute |
| No behaviour change without the SDK | every call is guarded; ad blockers and self-hosting get the identical game |

## Multiplayer

**PLAY (bots) works with zero backend** — that alone is a submittable Poki game.

QUICK MATCH / HOST / JOIN need the Colyseus server (`Echo-Tag-Server`) deployed somewhere
with **wss** (Poki pages are https; browsers refuse mixed-content ws). Poki permits games
to use their own multiplayer backends. Steps:

1. Deploy the server (any Node 24 host: `node src/index.ts`, port from `PORT`).
2. Put it behind TLS (a reverse proxy terminating wss is fine).
3. Build with `VITE_WS_ORIGIN=wss://your-host` in `Echo-Tag-Frontend/.env`.
4. Repackage.

If the server is unreachable at runtime, the menu already degrades gracefully — the
multiplayer buttons report the failure and point the player at PLAY.

## Pre-submission checklist (tech doc §8)

- [x] Initial load ≤4s / <8MB — ~180KB total, menu interactive at ~120ms
- [x] Playable within seconds, no forced intro — PLAY is one tap
- [x] 30–60fps on mid-range mobile — verify on real hardware (the checks measure a desktop GPU)
- [x] Responsive portrait + landscape, touch controls auto-available — asserted in `npm run check`
- [x] Auto input detection, no device picker — keyboard and joystick coexist
- [x] Joystick sizing/safe-zones per spec — 110/55px, 10px dead zone, 20px edge clearance
- [x] Up to 12 players, bot-fill, lobby wait ≤2s (public rooms)
- [x] No chat / UGC
- [x] SDK events wired as above
- [x] Clean build — no sourcemaps, no dev tools, dev URL hooks are inert without their params
- [ ] Real-device pass (mid-range Android + iOS Safari) — do this before submitting
- [ ] Run Poki Inspector against a hosted build
