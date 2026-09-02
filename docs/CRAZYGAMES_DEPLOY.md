# CrazyGames — deploy & review notes

The CrazyGames package: `npm run package:crazygames` → `echo-tag-crazygames.zip`
(CrazyGames SDK v3 tag kept, Poki tag stripped, chat ON, checked against their
50 MB / 250 MB / 1,500-file limits and for the bundled wss origin). Upload it as an
**HTML5** game; `index.html` is at the zip root.

Everything below is implemented on the `crazygames` branch and verified end-to-end by
`npm run check:cg` (real server + real build + a scripted stand-in for their SDK, which
refuses to run off crazygames.com/localhost).

## How the SDK is wired

| Requirement | Where |
|---|---|
| `init()` first, `loadingStart/Stop` around the load | `platform/crazygames.ts` (`cgInit`), called from `boot/main.ts` via `platform/portal.ts` |
| `gameplayStart()` on play, `gameplayStop()` on pause / round end / tab hidden / ad | `game/index.ts` (`portalGameplayStart/Stop`), same call sites as Poki's |
| Midgame ad between rounds, audio muted for its duration | `portalAdBreak` → `cgMidgameAd` (`ad.requestAd('midgame')`) |
| `happytime()` | fired when the local player wins a round |
| **updateRoom / leftRoom** | `net.onLobby` in `game/index.ts`: private rooms by 5-letter code (`inviteParams.room`), quick-match rooms by Colyseus id (`inviteParams.rid`); `isJoinable = humans < 12`; deduped in the facade; `leftRoom()` on leave, host-left and session teardown |
| **Invite params at load** | `boot/main.ts`: `cgInviteAtLoad()` → starts `{kind:'code'}` or `{kind:'id'}` before the menu is used |
| **Join listener while playing** | `boot/main.ts` `switchRoom()`: destroys the session and boots a new one on a fresh canvas — no page reload (their requirement) |
| **isInstantMultiplayer** | `boot/main.ts`: party leader is dropped straight into a hosted private room (joinable, code shown) |
| **Invite link** | lobby's COPY INVITE LINK uses `game.inviteLink({room})` when the SDK is live, else `?room=CODE` |
| **Usernames in-game** | `user.getUser().username` rides the join options; server sanitises to `[A-Za-z0-9_.]`, ≤20 chars, profanity-masked (`ArenaRoom.cleanName`), synced in `PlayerMeta.name`; shown in the lobby roster, results and chat |
| `settings.muteAudio` / `settings.disableChat`, live | `cgOnSettingsChange` in `game/index.ts` (third mute gate; chat UI mounted/unmounted) and `boot/main.ts` (menu audio) |
| Chat moderation (mandatory minimum: profanity filter) | server-side on every relay, `Echo-Tag-Shared/src/chat/profanity.ts` |
| Round-based continuation | private rooms return to their lobby after the results screen — nobody goes back to the CrazyGames UI |
| Fullscreen not hijacked inside their player | `underPortal()` exemption in `boot/main.ts` |
| Environment `disabled` (self-hosted copy) | facade treats it as "no SDK": every call is a no-op, the game behaves as the web build |

## Upload form answers

- Game engine: **html5**. Name: **Echo Tag**.
- "Online with Friends": **yes** — lobby min 1 (host + bots) / max 12.
- Supports muting through the SDK: **yes** (`settings.muteAudio`).
- Chat / UGC: **yes**, profanity-filtered server-side, never stored.
- Assets: `docs/store-assets/` (512 cover + four 1280x720 world screenshots).

## Server

The server must carry the `name` field (`Echo-Tag-Server/src/rooms/state/ArenaState.ts`)
for usernames to appear. Railway redeploys from `main`; merging this branch (or pointing
the Railway service at `crazygames`) ships it. Until then the client simply shows colours,
exactly as before — nothing breaks against the older server.

## Verify

```
npm run typecheck && npm test
npm run build && npm run size          # boot budget: SDK facade + portal layer ≈ +1 KB brotli
npm run check:cg                       # Online-with-Friends flows against a scripted SDK
npm run check:browser                  # 3 viewports, menu + play
npm run package:crazygames             # the zip, with the limits report
```

Preview on their side: upload, open the portal's preview, press QUICK MATCH once (proves
the wss origin from their domain) and HOST ROOM once (their invite button should appear).
