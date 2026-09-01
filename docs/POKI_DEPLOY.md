# Deploying Echo Tag to Poki

## Build the upload

```bash
npm run package        # → echo-tag-poki.zip (~1.3MB)
```

The zip is `Echo-Tag-Frontend/dist` minus sourcemaps and precompressed variants: an
`index.html` plus hashed chunks under `a/`, all referenced by **relative** paths
(`base: './'`), so it works from Poki's CDN subpaths. Every texture and map is generated
at runtime; the only fetched assets are the four MP3 sounds (~1.06MB), loaded by the
audio engine after Play. That keeps the build at ~1.3MB against Poki's 8MB
initial-download cap, with the interactive menu still under 8KB.

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

1. Deploy the server (any Node 24 host: `node src/index.ts`, port from `PORT`). The
   transport is uWebSockets (native binary, prebuilt by npm for linux/macOS/windows on
   x64 and arm64) — ~25% less CPU and ~25% less RSS than the default ws transport at
   100 concurrent rooms, measured with `tools/stress`.
2. Put it behind TLS (a reverse proxy terminating wss is fine).
3. Build with `VITE_WS_ORIGIN=wss://your-host` in `Echo-Tag-Frontend/.env`.
4. Repackage.

If the server is unreachable at runtime, the menu already degrades gracefully — the
multiplayer buttons report the failure and point the player at PLAY.

## Pre-submission checklist (tech doc §8)

- [x] Initial load ≤4s / <8MB — ~1.3MB total (of which ~1.06MB is lazily-fetched sound), menu interactive at ~120ms
- [x] Playable within seconds, no forced intro — PLAY is one tap
- [x] 30–60fps on mid-range mobile — verify on real hardware (the checks measure a desktop GPU)
- [x] Responsive portrait + landscape, touch controls auto-available — asserted in `npm run check`
- [x] Auto input detection, no device picker — keyboard and joystick coexist
- [x] Joystick sizing/safe-zones per spec — 110/55px, 10px dead zone, 20px edge clearance
- [x] Up to 12 players, bot-fill, lobby wait ≤2s (public rooms)
- [x] **Chat / UGC needs Poki's prior approval** — handled: `npm run package` builds with
      `VITE_CHAT=off`, which dead-code-eliminates the whole chat chunk from the Poki zip
      (verified: no `chat.*.js` emitted, no reference from the game chunk). The
      portal-neutral `package:web` zip keeps chat on. Once Poki approves chat, drop the
      flag from the `package` script and repackage.
- [x] SDK events wired as above — verified end-to-end against a stubbed PokiSDK
      (playwright): `init` → `gameLoadingFinished` when the menu is usable;
      `gameplayStart` fires only on the first real input during play (not on load, not on
      a menu tap); round end fires `gameplayStop` then `commercialBreak` with the mute
      callback invoked. When stubbing, block `game-cdn.poki.com` or the real SDK
      overwrites the stub mid-test.
- [x] No fullscreen hijack under Poki — the first-tap/game-start `requestFullscreen`
      calls are skipped whenever `PokiSDK` is present (Poki's page has its own
      fullscreen control); self-hosted builds keep the behaviour.
- [x] Menu audio (terror bed) is autoplay-safe: starts only on the first
      pointerdown/keydown, suspends on hidden tabs, closes when the game's engine starts.
- [x] Clean build — no sourcemaps, no dev tools, dev URL hooks are inert without their params
- [ ] Real-device pass (mid-range Android + iOS Safari) — do this before submitting
- [ ] Run Poki Inspector against a hosted build
- [ ] Multiplayer server: `.env` still points at localhost, so the current zip is
      **PLAY/bots-only on Poki** (`npm run package` warns about this). Deploy
      `Echo-Tag-Server` behind wss, set `VITE_WS_ORIGIN`, and repackage to light up
      QUICK MATCH / HOST / JOIN.
