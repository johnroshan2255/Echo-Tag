import { PLAYER_COLORS, ROUND_MINS_MAX, ROUND_MINS_MIN, RoundPhase } from '@echo-tag/shared'
import type { LobbyView } from './room.ts'

/**
 * The lobby / results overlay: plain DOM in the game's dusk-and-squares language.
 *
 * Square design rules, same as the boot menu: hard corners, chunky borders, the apricot
 * accent, colour identity shown as literal squares — the player IS a square-person, so
 * every roster row leads with their square.
 */

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

export interface LobbyUi {
  update(view: LobbyView): void
  destroy(): void
}

export const createLobbyUi = (
  onStart: () => void,
  onBots?: (n: number) => void,
  onMins?: (n: number) => void,
): LobbyUi => {
  const root = document.createElement('div')
  root.id = 'lobby'
  root.innerHTML = `
    <div id="lobby-card">
      <h2 id="lobby-title">WAITING FOR PLAYERS</h2>
      <p id="lobby-code" hidden>ROOM CODE <b></b><span>share it with your friends</span></p>
      <p id="lobby-count"></p>
      <div id="lobby-roster"></div>
      <div id="lobby-bots" hidden>
        <button id="bots-minus" type="button" aria-label="fewer bots">&#8211;</button>
        <span id="bots-label"></span>
        <button id="bots-plus" type="button" aria-label="more bots">+</button>
      </div>
      <div id="lobby-mins" hidden>
        <button id="mins-minus" type="button" aria-label="shorter round">&#8211;</button>
        <span id="mins-label"></span>
        <button id="mins-plus" type="button" aria-label="longer round">+</button>
      </div>
      <button id="lobby-start" type="button" hidden>START ROUND</button>
      <p id="lobby-hint"></p>
    </div>`
  const style = document.createElement('style')
  style.textContent = `
    /* grid + margin:auto (not place-content) so a card taller than a landscape phone
       scrolls instead of clipping its top and bottom off-screen. */
    #lobby { position: fixed; inset: 0; z-index: 3; display: grid; overflow-y: auto;
      background: rgba(13, 10, 22, .72); font-family: system-ui, sans-serif; }
    #lobby-card { background: #1d1830; border: 4px solid #3a3150; padding: 26px 34px;
      min-width: 300px; text-align: center; box-shadow: 8px 8px 0 rgba(0,0,0,.35);
      margin: auto; }
    #lobby-title { color: #f6f1ff; font-size: 18px; letter-spacing: .14em; margin: 0 0 14px; }
    #lobby-code { color: #b3a8c9; font-size: 12px; letter-spacing: .1em; margin: 0 0 14px; }
    #lobby-code b { display: block; color: #ffc07a; font-size: 34px; letter-spacing: .3em;
      margin: 6px 0 2px; }
    #lobby-code span { display: block; font-size: 11px; opacity: .8; }
    #lobby-roster { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
      margin: 0 0 16px; max-width: 320px; }
    .lobby-dot { width: 22px; height: 22px; border: 3px solid rgba(0,0,0,.4); }
    .lobby-dot.bot { opacity: .38; }
    #lobby-start { pointer-events: auto; cursor: pointer; border: 0; padding: 14px 34px;
      font: 800 16px/1 system-ui, sans-serif; letter-spacing: .12em; color: #241505;
      background: #ffc07a; box-shadow: 4px 4px 0 rgba(0,0,0,.4); }
    #lobby-start:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 rgba(0,0,0,.4); }
    #lobby-start:disabled { background: #574a3a; color: #2e2517; cursor: default;
      transform: none; box-shadow: 4px 4px 0 rgba(0,0,0,.4); }
    #lobby-count { color: #f6f1ff; font-size: 13px; letter-spacing: .12em; margin: 0 0 10px; }
    #lobby-bots, #lobby-mins { pointer-events: auto; display: flex; gap: 0; justify-content: center;
      align-items: stretch; margin: 0 0 12px; }
    #lobby-bots[hidden], #lobby-mins[hidden] { display: none; }
    #lobby-bots button, #lobby-mins button { cursor: pointer; width: 44px; min-height: 44px;
      border: 3px solid #3a3150; background: #262048; color: #e9ddff;
      font: 800 18px/1 ui-monospace, monospace; }
    #lobby-bots button:active, #lobby-mins button:active { background: #3a3150; }
    #bots-label, #mins-label { display: flex; align-items: center; justify-content: center;
      min-width: 96px; padding: 10px 16px; color: #ffc07a;
      border: 3px solid #3a3150; border-left: 0; border-right: 0; font: 800 13px/1 ui-monospace, monospace;
      letter-spacing: .12em; }
    #lobby-hint { color: #b3a8c9; font-size: 12px; margin: 12px 0 0; }
    #lobby.results #lobby-roster { flex-direction: column; align-items: stretch; }
    .lobby-row { display: flex; align-items: center; gap: 10px; color: #f6f1ff;
      font-size: 14px; justify-content: space-between; }
    .lobby-row .who { display: flex; align-items: center; gap: 10px; }
    .lobby-tag { font: 800 10px/1 ui-monospace, monospace; letter-spacing: .12em;
      padding: 3px 6px; border: 2px solid rgba(0,0,0,.4); }
    .lobby-tag.win { background: #ffc07a; color: #241505; }
    .lobby-tag.lose { background: #574a3a; color: #f6f1ff; }
    /* Landscape phones: the card must fit ~390px of height with both host rows showing. */
    @media (max-height: 520px) {
      #lobby-card { padding: 12px 22px; }
      #lobby-title { font-size: 15px; margin: 0 0 8px; }
      #lobby-code { margin: 0 0 8px; }
      #lobby-code b { font-size: 22px; margin: 2px 0 0; }
      #lobby-count { margin: 0 0 6px; }
      #lobby-roster { margin: 0 0 10px; }
      #lobby-bots, #lobby-mins { margin: 0 0 8px; }
      #lobby-start { padding: 10px 34px; min-height: 44px; }
      #lobby-hint { margin: 8px 0 0; }
    }
  `
  root.prepend(style)
  document.body.appendChild(root)

  const title = root.querySelector('#lobby-title') as HTMLElement
  const codeEl = root.querySelector('#lobby-code') as HTMLElement
  const codeVal = codeEl.querySelector('b') as HTMLElement
  const countEl = root.querySelector('#lobby-count') as HTMLElement
  const roster = root.querySelector('#lobby-roster') as HTMLElement
  const botsRow = root.querySelector('#lobby-bots') as HTMLElement
  const botsLabel = root.querySelector('#bots-label') as HTMLElement
  const botsMinus = root.querySelector('#bots-minus') as HTMLButtonElement
  const botsPlus = root.querySelector('#bots-plus') as HTMLButtonElement
  const minsRow = root.querySelector('#lobby-mins') as HTMLElement
  const minsLabel = root.querySelector('#mins-label') as HTMLElement
  const minsMinus = root.querySelector('#mins-minus') as HTMLButtonElement
  const minsPlus = root.querySelector('#mins-plus') as HTMLButtonElement
  const startBtn = root.querySelector('#lobby-start') as HTMLButtonElement
  const hint = root.querySelector('#lobby-hint') as HTMLElement
  startBtn.addEventListener('click', onStart)

  let last: LobbyView | null = null
  botsMinus.addEventListener('click', () => {
    if (last) onBots?.(Math.max(0, last.bots - 1))
  })
  botsPlus.addEventListener('click', () => {
    if (last) onBots?.(Math.min(12 - last.humans, last.bots + 1))
  })
  // The server clamps to [ROUND_MINS_MIN, ROUND_MINS_MAX]; mirror the same bounds here so
  // the buttons never look like they did something the server refused.
  minsMinus.addEventListener('click', () => {
    if (last) onMins?.(Math.max(ROUND_MINS_MIN, last.roundMins - 1))
  })
  minsPlus.addEventListener('click', () => {
    if (last) onMins?.(Math.min(ROUND_MINS_MAX, last.roundMins + 1))
  })

  return {
    update(view: LobbyView): void {
      last = view
      const inLobby = view.phase === RoundPhase.Lobby
      const results = view.phase === RoundPhase.Leaderboard
      root.style.display = inLobby || results ? 'grid' : 'none'
      root.classList.toggle('results', results)
      if (!inLobby && !results) return

      if (inLobby) {
        const seats = Math.min(12, view.humans + (view.isPrivate ? view.bots : 0))
        title.textContent = view.isPrivate ? 'YOUR ROOM' : 'FINDING PLAYERS'
        codeEl.hidden = !view.isPrivate
        codeVal.textContent = view.code
        countEl.textContent = view.isPrivate ? `${view.humans} / 12 PLAYERS` : `${view.humans} JOINED`
        botsRow.hidden = !(view.isPrivate && view.isHost)
        botsLabel.textContent = `BOTS: ${view.bots}`
        minsRow.hidden = !(view.isPrivate && view.isHost)
        minsLabel.textContent = `ROUND: ${view.roundMins} MIN`
        // Bots count toward a startable round: a solo host plus one bot is a real game,
        // and the bots +/- control they are shown must be able to take effect.
        const canStart = view.humans + view.bots >= 2
        startBtn.hidden = !(view.isPrivate && view.isHost)
        startBtn.disabled = !canStart
        hint.textContent = view.isPrivate
          ? view.isHost
            ? canStart
              ? `${seats} will play, ${view.roundMins} min — add bots or start with just your ${view.humans}`
              : 'you need one more player — add a bot or share the code'
            : `waiting for the host to start — ${view.roundMins} min round`
          : `${view.humans} joined — starting shortly, bots fill the rest`
        roster.innerHTML = view.scores
          .map(
            (p) =>
              `<div class="lobby-dot${p.isBot ? ' bot' : ''}" style="background:${hex(PLAYER_COLORS[p.colorSlot % PLAYER_COLORS.length]!)}"></div>`,
          )
          .join('')
      } else {
        title.textContent = 'ROUND OVER'
        codeEl.hidden = true
        startBtn.hidden = true
        botsRow.hidden = true
        minsRow.hidden = true
        hint.textContent = 'least time as the ghost wins — next round starting'
        // Winner = least It-time (#1). Loser = most — but only when strictly worst, so a
        // full-room tie never brands an arbitrary player.
        const worst = view.scores[view.scores.length - 1]
        const secondWorst = view.scores[view.scores.length - 2]
        roster.innerHTML = view.scores
          .map((p, i) => {
            const tag =
              i === 0 && view.scores.length > 1
                ? '<span class="lobby-tag win">WINNER</span>'
                : i === view.scores.length - 1 && secondWorst && worst!.itTimeMs > secondWorst.itTimeMs
                  ? '<span class="lobby-tag lose">LOST</span>'
                  : ''
            return (
              `<div class="lobby-row"><span class="who">` +
              `<span class="lobby-dot${p.isBot ? ' bot' : ''}" style="background:${hex(PLAYER_COLORS[p.colorSlot % PLAYER_COLORS.length]!)}"></span>` +
              `#${i + 1}${p.isBot ? ' · bot' : ''}</span><span>${tag} ${(p.itTimeMs / 1000).toFixed(1)}s</span></div>`
            )
          })
          .join('')
      }
    },
    destroy(): void {
      root.remove()
    },
  }
}
