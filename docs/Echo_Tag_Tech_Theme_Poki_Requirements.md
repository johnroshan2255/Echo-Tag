# ECHO TAG
### Tech Stack, Visual Theme & Poki Platform Requirements

---

## 1. TECH STACK

**Confirmed stack: WebGL rendering + Node.js backend + React + Vite frontend.**

| Layer | Tool | Why |
|---|---|---|
| Rendering / Engine | **PixiJS (WebGL renderer)** | Fast, mature WebGL2-based 2D renderer, integrates cleanly into a React component, handles sprites/particles/trail effects with GPU acceleration, excellent cross-device support (unlike WebGPU, which still has gaps on Safari/older/budget devices) |
| Frontend framework | **React + Vite** | Vite gives near-instant builds and a small optimized output bundle (critical for the 1–4 second load requirement); React manages UI layers (menus, HUD, lobby, leaderboard) around the PixiJS canvas |
| Game loop / rendering bridge | PixiJS canvas mounted inside a React component (`useRef` + `useEffect`), with PixiJS's own ticker driving the game loop — React handles UI state, PixiJS handles the arena rendering | Keeps UI reactive/declarative while keeping the actual game loop performant and outside React's re-render cycle |
| Multiplayer / Networking | **Node.js + Colyseus** (or **Poki Netlib** if using Poki's infra) | Real-time authoritative server for room-based state sync — server tracks player positions, ghost trail history, and "It" status; broadcasts state to all clients each tick |
| Animation | Sprite sheets loaded via PixiJS's `AnimatedSprite`, exported from Aseprite or similar | Small file size, fast load, simple frame-based animation (idle, move, tagged, celebrate) |
| Ghost trail effect | Server-authoritative position-history buffer per player (last 3 seconds), rendered client-side as alpha-blended PixiJS sprite copies | GPU-accelerated blending via WebGL keeps this cheap even with 12 players' trails on screen at once |
| Visual polish | PixiJS filters (`GlowFilter`, `BloomFilter` from `pixi-filters`) for the "It" player glow and trail shimmer | WebGL-based filters, no shader code needed, lightweight |
| Backend data (saves/settings) | **Poki AUDS** (Arbitrary User Data Store) | Free tool Poki provides for lightweight backend storage — no need to run your own DB for simple settings/progress |
| Testing/QA | **Poki Inspector** | Poki's official tool to check your game against their requirements before submission |

**Why WebGL over WebGPU:** WebGPU browser support is still inconsistent (notably Safari and older/budget devices), and Echo Tag's visuals don't need 3D or heavy shader work. WebGL2 via PixiJS covers everything needed — trail blending, glow effects, particle bursts — with far better cross-device reliability, which matters since Poki's audience plays on everything from high-end desktops to low-end phones.

**Why Node.js + Colyseus for the backend:** The ghost trail mechanic requires the server to be the source of truth for player positions over time — if trails were client-authoritative, players could desync or cheat by manipulating their own trail history. A Node.js server with Colyseus (or Poki Netlib) keeps a rolling 3-second position buffer per player server-side, resolves collisions authoritatively, and pushes state updates to all clients each tick — keeping the game fair and in sync across up to 12 players.

---

## 2. VISUAL THEME & COLOR PALETTE

**Overall direction:** High-contrast neon-on-dark, playful and chaotic — think Agar.io/Venge.io simplicity with a candy-neon palette.

| Element | Color / Style |
|---|---|
| Background | Deep charcoal/navy (`#12141c`) — flat color, cheap to render, makes everything else pop |
| Player colors (8–12 distinct) | Saturated neon set: hot pink, cyan, lime green, orange, purple, yellow, red, teal — assigned uniquely per player so trails are instantly identifiable |
| "It" player indicator | Pulsing white/red outline or glow ring — must read instantly at a glance in a busy arena |
| Ghost trails | Same hue as the player at ~30–40% opacity, thin outline for readability as obstacles, not just decoration |
| UI/HUD | Minimal, rounded, bold sans-serif font, bright accent color for timer and "It" status |

**Design rule:** Every visual choice should answer "can a player parse this in under half a second?" — since the game is fast and chaotic, clarity beats detail every time.

---

## 3. CHARACTER DESIGN

**Style: Voxel/particle-based humanoid — built from small squares, not sprite images.**

Characters are **procedurally generated in code** using a grid of small square sprites arranged into a humanoid silhouette (head, torso, arms, legs) — similar in spirit to a low-res voxel figure (think Minecraft skin resolution), but rendered flat in 2D. No external image assets required.

### 3.1 Why code-generated squares instead of drawn sprites
- **Zero asset pipeline** — no PNGs, no sprite sheet exporting/packing, no extra load time (critical for the 1–4 second load requirement).
- **Instant recoloring** — each of the 12 players needs a unique color; squares just take a color parameter instead of needing 12 pre-made image variants.
- **Tiny file size** — a grid template + generation code is a few KB vs. potentially megabytes of image assets.
- **Cheap, satisfying effects for free** — since the character is literally made of independent square objects, effects like "explode into squares when tagged" cost almost nothing extra to build.

### 3.2 Square count (performance-tuned)
- **Do NOT use 1000 squares per character.** With up to 12 live players plus their ghost trails on screen simultaneously, that's far too heavy for stable 60 FPS on mid-range mobile devices (a hard Poki requirement).
- **Live players: ~150–250 squares per humanoid.** This is plenty to read clearly as a voxel-humanoid at typical on-screen size — more squares add cost without adding visible clarity at this scale.
- **Ghost trails: do NOT render full detailed square-humanoids.** Render a simplified low-detail silhouette or flat-colored blob instead. Trails need to read instantly as *obstacles*, not detailed characters — this is both a performance win and a gameplay-clarity win.
- **Render via `PixiJS ParticleContainer`**, not regular `Graphics` objects. `ParticleContainer` batches thousands of small identical sprites into far fewer WebGL draw calls — exactly the right tool for this many small squares moving every frame.

### 3.3 How it's built (implementation approach)
1. Define a **grid template** for the humanoid pose — a 2D array marking which grid cells are filled vs. empty (head, torso, arms, legs), like a pixel-art blueprint.
2. Loop through the template at generation time and spawn one small square sprite per filled cell, tinted to the player's assigned color.
3. Group all squares for one character into a single container so they move together as one unit during normal movement.
4. Keep template data separate from render logic so pose variants (idle, walk frames, tagged pose) are just different grid arrays reused by the same generation function.

### 3.4 Character elements
- **Body:** humanoid silhouette built from the square grid (head, torso, arms, legs), colored per player identity.
- **Face:** a few squares reserved for simple eyes (can darken/brighten to fake blinking — see animation section).
- **Outline/edge squares:** slightly darker-shade squares on the silhouette's outer edge for definition against the dark background.
- **"It" indicator:** glowing ring or outline pulse around the whole square-cluster (via `GlowFilter`) when that player is "It," plus optionally tinting the edge squares red/white.
- **Cosmetic slot (future):** swap a small set of "hat" squares above the head grid for unlockable cosmetics — cheap to add later since it's just another small grid overlay.

---

## 4. CHARACTER ANIMATION (Procedural, Not Frame-Based)

Since characters are code-generated square clusters rather than drawn sprite sheets, animation is done through **procedural transforms applied every frame**, not hand-drawn animation frames. This is the same general approach used by .io-style games (Agar.io, Slither.io) — cheap, scalable, no animator needed.

| Animation | How it's done in code |
|---|---|
| **Idle** | Slight vertical bob on the whole square-cluster (sine wave on y-position) + occasional "blink" (eye squares briefly darken/shrink) |
| **Moving / Walking** | Leg squares alternate offset positions to fake a step cycle; whole cluster gets subtle squash-and-stretch scaling in the direction of travel for a "juicy" feel |
| **Turning** | Eye squares (and optionally head squares) shift slightly to face the current movement direction |
| **Tagged (became "It")** | Squares briefly **scatter outward** then snap back into formation (cheap and free to build since each square is already an independent object) — followed by settling into the glowing "It" state |
| **Celebration (leaderboard screen)** | Squares bounce/spin briefly using simple eased tweening (e.g., via `gsap` or PixiJS's ticker with easing functions) |
| **Ghost trail rendering** | NOT the full square-humanoid — render the simplified low-detail silhouette version, redrawn each frame from stored position history at reduced opacity. This keeps trails cheap and visually distinct from live players |

**Key implementation note:** keep animation logic decoupled from the grid-generation logic — animation should just apply per-frame position/scale/color offsets to existing square objects, not regenerate the grid each frame. Regenerating the full square set every frame would be unnecessarily expensive; only individual square transforms should update per tick.

---

## 5. CONTROLS — CROSS-DEVICE INPUT DESIGN

Since this is a **browser game playable on any device** (desktop, laptop, tablet, phone), controls must be built for **two fully separate input schemes** that auto-detect and switch based on device type — this is also a hard Poki requirement (see 5.3 below).

### 5.1 PC Controls (Keyboard)
- **Movement:** `WASD` or `Arrow Keys` (support both simultaneously — don't force a choice).
- No mouse required for core movement — keeps it simple and matches genre conventions (Iron Snout, Stickman-style Poki games use keyboard-first schemes).
- Optional: mouse-look/aim only if a future variant adds directional dashes — not needed for MVP.

### 5.2 Mobile Controls (Touch)
Mobile needs **on-screen buttons**, not swipe/tilt — swipe controls are imprecise for a game requiring tight dodging around ghost trails, and tilt controls fatigue players quickly and misfire during fast play.

**Recommended layout: Virtual joystick (left thumb zone), no separate action button needed** since movement is the only input (tagging happens via collision, not a button press).

**Button/control design specs:**
- **Virtual joystick** (floating or fixed) in the **bottom-left quadrant** of the screen — thumb-natural zone for right-handed and left-handed play alike.
- **Floating joystick preferred over fixed:** appears wherever the player's thumb first touches down within the zone, reducing mis-taps and adapting to different hand sizes/grips.
- **Joystick base size:** ~100–120px diameter; **stick knob:** ~50–60px — large enough for accurate thumb control without covering too much of the play area.
- **Opacity:** semi-transparent (~50–60%) when idle, slightly more opaque when actively touched, so it doesn't visually clutter the arena but is still easy to locate.
- **Dead zone:** small central dead zone (~10px) to prevent drift/jitter from minor thumb tremor.
- **No buttons on the right side** needed for MVP (no jump/action key) — keeps the screen uncluttered, which matters since the arena itself gets visually busy with ghost trails.
- **Safe zone padding:** keep joystick and any HUD elements at least 20px from screen edges to avoid conflicts with mobile OS gesture zones (iOS home bar swipe, Android back-gesture edge).

### 5.3 Auto-Detection & Responsiveness
- Detect input method on load (touch capability + screen size) and **show the correct control scheme automatically** — no manual "select your device" step, which would waste load-time budget.
- If a touch-capable device also has a keyboard connected (e.g., iPad + keyboard case), support both simultaneously without conflict.
- Controls must scale proportionally across portrait and landscape mobile layouts (per Poki's responsive design requirement).
- Test on a **representative range of mid-range phones**, not just flagship devices, since Poki's real audience skews toward varied hardware.

### 5.4 Why This Matters for Echo Tag Specifically
- The game's core tension is **precise, fast dodging** — sloppy touch controls (swipe-based or tilt-based) would make mobile players feel at a disadvantage vs. keyboard players, hurting retention on Poki's largely mobile traffic.
- A joystick-only scheme (no action button) keeps mobile UI minimal, which matters because the **ghost trails already add visual density** — extra on-screen buttons would compete for attention and clutter a small phone screen.

---

## 6. POKI PLATFORM REQUIREMENTS (Must-Haves)

These are **non-negotiable** for submission and acceptance on Poki — pulled from Poki's official developer requirements.

### 6.1 Load Time & File Size
- **Initial load must complete in 1–4 seconds** on standard network conditions (3G mobile or better).
- **Target initial download size: under 8MB**; total game size should stay well under 20MB.
- Game must reach **playable gameplay within seconds** of load — no long intros, splash screens, or forced tutorials before the first interaction.
- `gameplayStart()` SDK event must fire on the player's **first input**, not on load.

### 6.2 Performance
- Minimum **30 FPS**, target **60 FPS**, on mainstream mobile and desktop devices.
- Must run reliably on **mid-range mobile phones** released within the last few years, not just high-end devices.

### 6.3 Responsiveness
- Must be **fully responsive**, supporting both landscape and portrait (portrait unlocks banner ad placement on mobile).
- Must support **16:9 aspect ratio** across devices.
- Mobile control schemes must be **automatically applied** on tablets/phones (touch controls, not just keyboard).

### 6.4 Reliability
- No game-breaking bugs: no freezes, infinite loading, progress resets, or broken UI.
- Clean build — no debug code, dev tools, or test artifacts left in the shipped version.
- Bugs reported post-launch must be fixed within 1 month.

### 6.5 Multiplayer-Specific Requirements
- Any chat or user-generated content requires **Poki's prior approval** and content moderation tools.
- Should use **Poki Netlib** where possible for optimized multiplayer performance on their infrastructure.

---

## 7. LOBBY DESIGN (Echo Tag Specific)

Given Poki's "instant fun" philosophy, the lobby must be **near-invisible** — players should barely notice they're "waiting."

**Flow:**
1. **Game loads → instantly shows arena preview + "Play" button** (no forced menu navigation).
2. On tapping Play, player is placed into a **matchmaking queue for up to 2 seconds**.
3. **If 12 players aren't available within ~2 seconds, fill remaining slots with bots** so the round starts immediately — never make a player wait for humans.
4. Bots use simplified AI: basic pathing + reactive dodging, tuned to feel plausible but slightly less optimal than real players (keeps humans feeling capable, avoids bots dominating leaderboard).
5. Round starts automatically once the lobby is full (human + bot combined) — **max wait time: 3 seconds total.**
6. **No lobby chat, no room codes for MVP** — keeps moderation simple and matches Poki's fast-access philosophy (private rooms/friend codes can be a v2 feature, pending Poki approval for any social features).

### Player Count Handling
- **Target: up to 12 players per round.**
- **Minimum to start with real players only: not required** — bots fill any gap so a round always starts fast.
- If a real player count is very low (e.g., late-night/regional off-peak), the round can run **majority-bot** without the player noticing a difference in pacing.
- As more real players join mid-cycle, future rounds naturally shift toward higher human ratios.

---

## 8. SUMMARY CHECKLIST BEFORE SUBMISSION

- [ ] Initial load ≤ 4 seconds, file size < 8MB
- [ ] Playable within seconds of load, no forced intro
- [ ] 30–60 FPS on mid-range mobile devices
- [ ] Responsive (portrait + landscape), touch controls auto-enabled on mobile
- [ ] Auto-detect input scheme (keyboard vs. touch joystick) with no manual device selection
- [ ] Mobile joystick tested for size, placement, and OS gesture-zone conflicts on real devices
- [ ] Up to 12 players per round, bot-fill if human count is low
- [ ] Lobby wait capped at ~3 seconds max
- [ ] No chat/UGC unless approved by Poki
- [ ] SDK events (`gameplayStart`, `gameplayStop`) implemented correctly
- [ ] Clean build, no debug artifacts
- [ ] Character square-count kept in 150–250 range per live player (not 1000)
- [ ] `ParticleContainer` used for square rendering, ghost trails use simplified low-detail silhouette
- [ ] Tested via Poki Inspector before submission

---

*Document version 1.0 — Tech & Platform Requirements Draft*
