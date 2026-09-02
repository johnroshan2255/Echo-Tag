# Store Listings & Distribution Kit

Copy-paste material for every portal, plus the distribution checklist. The game ships
three zips: `npm run package` → `echo-tag-poki.zip` (with the Poki SDK, chat OFF),
`npm run package:crazygames` → `echo-tag-crazygames.zip` (portal-neutral, chat ON,
checked against CrazyGames' 50 MB / 1,500-file limits) and `npm run package:web` →
`echo-tag-web.zip` (portal-neutral, chat ON — itch.io, GameDistribution, Newgrounds,
self-hosting).

Chat policy differs per portal: Poki wants prior approval for any chat/UGC, so the Poki
zip strips it. CrazyGames allows chat provided it is moderated — the server masks
profanity on every relay (`Echo-Tag-Shared/src/chat/profanity.ts`), which is their
stated minimum. For a CrazyGames **Full Launch** (ads on) the game must also integrate
their SDK, including honouring the SDK's chat-disable setting.

Multiplayer needs the Colyseus server deployed with wss and `VITE_WS_ORIGIN` set at
build time (see POKI_DEPLOY.md) — PLAY (bots) works on every portal with zero backend.

---

## Name

**Echo Tag** everywhere. If a portal rewards genre suffixes, list as
**Echo Tag — Ghost Tag .io** (keep "Echo Tag" the brand).

## Short description (≤ 140 chars)

> Tag, but the monster is one of you. Outrun the ghost, dodge spiders and UFOs across
> 4 haunted pixel worlds. 12 players, free.

## Long description

> **Don't be the monster when the clock runs out.**
>
> Echo Tag is multiplayer tag in four haunted pixel worlds — and on every map, "It" is
> a different monster. In the manor you're hunted by a **ghost** whose echo trail walls
> the maze behind it. In the forest, a **wraith** drifts between the trees. In the cave,
> a **spider** snares you with webs. In the hive, an **alien** charges a beam you'd
> better not be standing in.
>
> The world itself hunts too: nest spiders drag you into their webs, UFOs pull you into
> their tractor beams — struggle free before the monster arrives, or become it.
>
> Hide in wardrobes (find the key first), slip through teleporters, throw goo and set
> traps. Whoever spends the least time as the monster wins.
>
> - **12 players** — quick match with bot-fill, or host a private room and share a
>   5-letter code with friends
> - **4 worlds, 4 monsters**, each with its own powers and hazards
> - Runs in your browser, phone or laptop, **no download, no account**
> - Loads in about a second, even on school Chromebooks

## Keywords / tags

`multiplayer` `tag` `ghost` `horror` `io` `pixel art` `play with friends`
`no download` `2 player+` `chase` `hide and seek` `monster` `spooky` `casual`

## Category

Multiplayer / .io / Casual → secondary: Horror, Arcade.

---

## Assets

- Thumbnail: build from `Echo-Tag-Frontend/public/og.png`'s cast (white ghost front and
  centre, red-eyed spider lurking) — portals crop differently, so keep the ghost's face
  inside the middle 60%.
- Link preview (`og.png`), PWA icons (`icon-192/512.png`): shipped in the build, and
  regenerable with the generator noted in the git history if the cast changes.
- Preview video (CrazyGames supports it): 10–15s — a chase, a web landing, the UFO
  grabbing someone *just* as the ghost arrives, the CAUGHT! banner. Capture at
  1280x720 with `?nofog` OFF (fog is the mood).

## Localisation

The game self-localises (menus, lobby, banners) into **EN, PT-BR, ES, TR, ID, RU, DE,
FR** from the browser language (`src/platform/i18n.ts`; test with `?lang=pt`).
Translate the store description per portal where the portal doesn't auto-translate —
PT-BR and ES first: they are the biggest non-EN traffic pools.

## Submission checklist per portal

- [ ] Poki: `echo-tag-poki.zip` — chat approval FIRST (or ship chat behind a flag).
- [ ] CrazyGames: `echo-tag-crazygames.zip` + `docs/store-assets/` (cover-512 + four
      1280x720 screenshots) + preview video. Basic Launch needs no SDK (and pays
      nothing); Full Launch = CrazyGames SDK + chat-disable preference + second QA.
- [ ] itch.io: `echo-tag-web.zip` as HTML5 playable + devlog post (the "4 worlds,
      4 monsters" writeup with the world screenshots).
- [ ] GameDistribution / Newgrounds: `echo-tag-web.zip`.
- [ ] Self-host (echotag.example): point OG links here — invite unfurls work best on a
      domain you own; this is also the URL to put in social bios and clips.

## The growth loop to protect

Share links are the engine: lobby → COPY INVITE LINK → link unfurls as a game card →
friend clicks → lands *in the room* (`?room=CODE` rejoin flow). Anything that breaks
that chain (a portal that blocks clipboard, an iframe origin without the game at its
URL) breaks acquisition — test the loop on every portal before submitting.
