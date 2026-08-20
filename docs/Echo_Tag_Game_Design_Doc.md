# ECHO TAG
### A Fast Multiplayer Browser Game — Game Design Document

---

## 1. STORY / CONCEPT

In the world of **Echo Tag**, every player exists in two places at once — the present, and 3 seconds in the past.

There is no explanation, no lore, no cutscenes. You drop into a small glowing arena with 7–11 other players. The moment you move, a **translucent echo** of yourself is born — a ghost that repeats your last 3 seconds of movement on a permanent loop, over and over, as a solid obstacle.

You are being chased by others. You are chasing others. And you are, quite literally, **being cornered by your own past.**

The arena has no walls that matter — the real maze is made of everyone's echoes, stacking second after second, turning empty space into a shifting labyrinth. There is no way out of the round, no elimination, no death. Just one simple truth for the full 3 minutes:

> **Don't be "It" when the clock runs out.**

---

## 2. THE GOAL

- Each round lasts **3 minutes**.
- One player starts as **"It."**
- **Goal:** Spend as little total time as "It" as possible during the round.
- **No one is ever eliminated.** Everyone plays the full round.
- At the end, the leaderboard ranks players by **total time spent as It** (least = best).

---

## 3. CORE RULES

### 3.1 Movement & Echoes
- Every player leaves a **ghost trail** representing their exact position over the last **3 seconds**.
- Ghost trails are **solid** — colliding with any ghost (yours or another player's) blocks your movement, like hitting a wall.
- Ghosts are **not frozen** — they continuously replay the trail on a rolling 3-second delay, so they shift and move even as new ones are created.
- The longer a round runs, the more ghosts accumulate, and the tighter the playable space becomes.

### 3.2 Being "It"
- The player who is "It" is clearly marked (glowing outline / distinct color).
- "It" moves **slightly faster** than other players (small speed boost, enough to make catching possible but not guaranteed).
- To tag a new "It," the current "It" simply needs to **touch a live player** (ghosts do not count as tag targets).
- Upon tagging:
  - The tagged player becomes the new "It" immediately.
  - The old "It" returns to normal speed.
  - The new "It" gets a **1-second tag immunity window** to prevent instant re-tagging.

### 3.3 Ending a Round
- The round timer runs for 3 minutes, regardless of how many tags happen.
- When time expires, the game **freezes and tallies total "It" time per player**.
- Leaderboard displayed: least time as "It" → most time as "It."
- Last place gets a lighthearted animation (no punishment, just a fun visual gag) to keep the tone playful, not punishing.

---

## 4. DESIGN PRINCIPLES (Why the rules work)

| Mechanic | Purpose |
|---|---|
| Ghost trails | Auto-generates the "level design" — no manual map building needed |
| 3-second delay | Punishes reckless movement; rewards efficient, controlled paths |
| No elimination | Keeps every player engaged for the full round — no dead time |
| Increasing ghost density | Naturally ramps difficulty without scripted level progression |
| Speed boost for "It" | Ensures tags are possible without making the chase trivial |
| Short rounds (3 min) | Matches Poki's fast session / high-replay design pattern |

---

## 5. SESSION FLOW (Player Experience)

1. **Instant matchmaking** — no lobby waits, drop straight into an open round.
2. **0:00–0:30** — Open space, easy movement, light tension.
3. **0:30–2:00** — Ghost density builds, dodging becomes tactical, tags get harder to land cleanly.
4. **2:00–3:00** — Arena is dense with echoes; frantic, chaotic movement; high tension finish.
5. **Round end** — Leaderboard, quick "Play Again" button, next round starts almost immediately.

---

## 6. PLAYER COUNT & FORMAT

- **8–12 players** per round (sweet spot for chaos without being unreadable).
- **Free-for-all** format — no teams, no rooms/private codes needed for MVP (could be added later).
- Arena size scales slightly with player count to keep density consistent.

---

## 7. TONE & VISUAL STYLE

- Bright, simple shapes/characters (stickman or blob-style avatars) — cheap to produce, fast to render.
- Ghosts rendered as **semi-transparent trailing copies** in the player's own color, so it's visually clear whose echo belongs to whom.
- "It" player glows or pulses to stand out instantly at a glance.
- No violence, no elimination, no dark tone — playful and chaotic, aimed at quick dopamine hits rather than competitive intensity.

---

## 8. WHY THIS FITS POKI

- Round length (2–3 min) matches Poki's ad-break/session cadence.
- No login, no lobby, no long onboarding — instant play.
- Self-balancing difficulty means no complex level design pipeline.
- Visually distinctive (crisscrossing ghost trails) — strong thumbnail/trailer material for organic clicks.
- Genuinely novel mechanic not currently seen in Poki's existing tag/io game catalog.

---

*Document version 1.0 — Draft for prototyping*
