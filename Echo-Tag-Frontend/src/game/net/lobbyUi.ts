import { MAP_COUNT, MAP_TILES_X, MAP_TILES_Y, MAPS, MONSTER_NAMES, PLAYER_COLORS, ROUND_MINS_MAX, ROUND_MINS_MIN, RoundPhase } from '@echo-tag/shared'
import type { LobbyView } from './room.ts'
import { drawMinimap } from '../../boot/minimap.ts'
import { TG } from '../../platform/i18nGame.ts'

/**
 * The lobby / results overlay: plain DOM in the game's dusk-and-squares language.
 *
 * Square design rules, same as the boot menu: hard corners, chunky borders, the apricot
 * accent, colour identity shown as literal squares — the player IS a square-person, so
 * every roster row leads with their square.
 */

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`
/** Usernames are server-sanitised to [A-Za-z0-9_.], but the roster is innerHTML — escape anyway. */
const esc = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const nameTag = (name?: string): string => (name ? `<span class="lobby-name">${esc(name)}</span>` : '')

export interface LobbyUi {
  update(view: LobbyView): void
  destroy(): void
}

export const createLobbyUi = (
  onStart: () => void,
  onBots?: (n: number) => void,
  onMins?: (n: number) => void,
  onMap?: (n: number) => void,
  /** Builds the invite URL for a code; defaults to this page + ?room=CODE. */
  inviteUrl?: (code: string) => string,
): LobbyUi => {
  const root = document.createElement('div')
  root.id = 'lobby'
  root.innerHTML = `
    <div id="lobby-shadow"><div id="lobby-card" class="px crt">
      <h2 id="lobby-title">${TG.finding}</h2>
      <p id="lobby-code" hidden>${TG.roomCode} <b></b><span>${TG.shareIt}</span></p>
      <button id="lobby-invite" type="button" class="px-s bv" hidden>${TG.copyLink}</button>
      <p id="lobby-count"></p>
      <div id="lobby-roster"></div>
      <div id="lobby-bots" class="px-s" hidden>
        <button id="bots-minus" type="button" aria-label="fewer bots">&#8211;</button>
        <span id="bots-label"></span>
        <button id="bots-plus" type="button" aria-label="more bots">+</button>
      </div>
      <div id="lobby-mins" class="px-s" hidden>
        <button id="mins-minus" type="button" aria-label="shorter round">&#8211;</button>
        <span id="mins-label"></span>
        <button id="mins-plus" type="button" aria-label="longer round">+</button>
      </div>
      <div id="lobby-map" class="px-s" hidden>
        <button id="map-minus" type="button" aria-label="previous map">&#9664;</button>
        <div id="map-preview">
          <canvas id="map-canvas"></canvas>
          <div id="map-foot">
            <span id="map-label"></span>
            <span id="map-pips"></span>
          </div>
        </div>
        <button id="map-plus" type="button" aria-label="next map">&#9654;</button>
      </div>
      <button id="lobby-start" type="button" class="px-s bv-a" hidden>${TG.start}</button>
      <p id="lobby-hint"></p>
    </div></div>`
  const style = document.createElement('style')
  style.textContent = `
    /* grid + margin:auto (not place-content) so a card taller than a landscape phone
       scrolls instead of clipping its top and bottom off-screen. */
    #lobby { position: fixed; inset: 0; z-index: 3; display: grid; overflow-y: auto;
      background: rgba(13, 10, 22, .72); font-family: system-ui, sans-serif; }
    /* Shadow on the wrapper: a same-element clip-path would clip the shadow away. */
    #lobby-shadow { margin: auto; filter: drop-shadow(8px 8px 0 rgba(0,0,0,.35)); }
    #lobby-card { background: #1d1830; border: 4px solid #3a3150; padding: 26px 34px;
      min-width: 300px; text-align: center; }
    #lobby-title { color: #f6f1ff; font: 400 13px/1.5 var(--pf); letter-spacing: .05em; margin: 0 0 14px; }
    #lobby-code { color: #b3a8c9; font-size: 12px; letter-spacing: .1em; margin: 0 0 14px; }
    #lobby-code b { display: block; color: #ffc07a; font: 400 24px/1.3 var(--pf);
      letter-spacing: .14em; margin: 8px 0 4px; }
    #lobby-code span { display: block; font-size: 11px; opacity: .8; }
    /* The invite button: the acquisition loop — one tap turns a room into a shareable
       link. Styled like the +/- chips, sized for thumbs. */
    #lobby-invite { pointer-events: auto; cursor: pointer; margin: 0 0 14px; min-height: 40px;
      padding: 10px 18px; border: 3px solid #3a3150; background: #262048; color: #e9ddff;
      font: 400 9px/1.4 var(--pf); letter-spacing: .04em; }
    #lobby-invite:active { background: #3a3150; }
    #lobby-invite.copied { border-color: #7ccb66; color: #a4dd85; }
    #lobby-roster { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
      margin: 0 0 16px; max-width: 320px; }
    .lobby-dot { width: 22px; height: 22px; border: 3px solid rgba(0,0,0,.4); }
    .lobby-dot.bot { opacity: .38; }
    /* Square + (portal username): friends find each other by name, everyone else by colour. */
    .lobby-who { display: inline-flex; align-items: center; gap: 6px; }
    .lobby-name { font: 400 9px/1 var(--pf); color: #e9ddff; letter-spacing: .04em;
      max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #lobby-start { pointer-events: auto; cursor: pointer; border: 0; padding: 14px 30px;
      font: 400 12px/1.4 var(--pf); letter-spacing: .04em; color: #241505;
      background: #ffc07a; }
    #lobby-start:active { transform: translate(2px, 2px); }
    #lobby-start:disabled { background: #574a3a; color: #2e2517; cursor: default;
      transform: none; }
    #lobby-count { color: #f6f1ff; font-size: 13px; letter-spacing: .12em; margin: 0 0 10px; }
    #lobby-bots, #lobby-mins, #lobby-map { pointer-events: auto; display: flex; gap: 0; justify-content: center;
      align-items: stretch; margin: 0 0 12px; }
    #lobby-bots[hidden], #lobby-mins[hidden], #lobby-map[hidden] { display: none; }
    #lobby-bots button, #lobby-mins button, #lobby-map button { cursor: pointer; width: 44px; min-height: 44px;
      border: 3px solid #3a3150; background: #262048; color: #e9ddff;
      font: 400 13px/1 var(--pf); }
    #lobby-bots button:active, #lobby-mins button:active, #lobby-map button:active { background: #3a3150; }
    #bots-label, #mins-label, #map-preview { display: flex; align-items: center; justify-content: center;
      min-width: 96px; padding: 10px 16px; color: #ffc07a;
      border: 3px solid #3a3150; border-left: 0; border-right: 0; font: 400 9px/1.5 var(--pf);
      letter-spacing: .04em; }
    /* The map row grows into a proper preview: a true miniature of the whole arena
       (20:11), so it takes the width the card can give it, capped by height on
       landscape phones. Hard corners — same brick language as everything else. */
    #lobby-map { width: min(80vw, 400px); margin-left: auto; margin-right: auto; }
    #map-preview { flex: 1; min-width: 0; flex-direction: column; padding: 8px; background: #1d1830; }
    #map-canvas { display: block; width: min(100%, calc(28vh * 20 / 11)); aspect-ratio: 20/11;
      margin: 0 auto 6px; border: 2px solid #3a3150; background: #262038; }
    #map-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; }
    #map-label { line-height: 1; text-shadow: none; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; }
    #map-pips { display: flex; gap: 5px; flex-shrink: 0; }
    #map-pips i { width: 8px; height: 8px; background: #3a3150; }
    #map-pips i.on { background: #ffc07a; }
    #lobby-hint { color: #b3a8c9; font-size: 12px; margin: 12px 0 0; }
    #lobby.results #lobby-roster { flex-direction: column; align-items: stretch; }
    .lobby-row { display: flex; align-items: center; gap: 10px; color: #f6f1ff;
      font-size: 14px; justify-content: space-between; }
    .lobby-row .who { display: flex; align-items: center; gap: 10px; }
    .lobby-tag { font: 400 8px/1.4 var(--pf); letter-spacing: .04em;
      padding: 3px 6px; border: 2px solid rgba(0,0,0,.4); }
    .lobby-tag.win { background: #ffc07a; color: #241505; }
    .lobby-tag.lose { background: #574a3a; color: #f6f1ff; }
    /* Landscape phones: the card must fit ~390px of height with both host rows showing. */
    @media (max-height: 520px) {
      #lobby-card { padding: 12px 22px; }
      #lobby-title { font-size: 11px; margin: 0 0 8px; }
      #lobby-code { margin: 0 0 8px; }
      #lobby-code b { font-size: 16px; margin: 2px 0 0; }
      #lobby-count { margin: 0 0 6px; }
      #lobby-roster { margin: 0 0 10px; }
      #lobby-bots, #lobby-mins, #lobby-map { margin: 0 0 8px; }
      #lobby-map { margin-left: auto; margin-right: auto;
        width: min(80vw, calc(22vh * 20 / 11 + 114px)); }
      #map-canvas { width: min(100%, calc(22vh * 20 / 11)); }
      #lobby-start { padding: 10px 34px; min-height: 44px; }
      #lobby-hint { margin: 8px 0 0; }
    }
  `
  root.prepend(style)
  document.body.appendChild(root)

  const title = root.querySelector('#lobby-title') as HTMLElement
  const codeEl = root.querySelector('#lobby-code') as HTMLElement
  const codeVal = codeEl.querySelector('b') as HTMLElement
  const inviteBtn = root.querySelector('#lobby-invite') as HTMLButtonElement
  // The invite link: the current page with ?room=CODE — the same URL the refresh-rejoin
  // flow already understands, so a clicked invite lands directly in this room.
  let inviteResetTimer: ReturnType<typeof setTimeout> | undefined
  inviteBtn.addEventListener('click', () => {
    const code = codeVal.textContent ?? ''
    if (code.length !== 5) return
    const url = inviteUrl?.(code) ?? `${location.origin}${location.pathname}?room=${code}`
    const done = (): void => {
      inviteBtn.textContent = TG.copied
      inviteBtn.classList.add('copied')
      clearTimeout(inviteResetTimer)
      inviteResetTimer = setTimeout(() => {
        inviteBtn.textContent = TG.copyLink
        inviteBtn.classList.remove('copied')
      }, 1600)
    }
    try {
      void navigator.clipboard.writeText(url).then(done, () => prompt(TG.copyLink, url))
    } catch {
      // Clipboard can be blocked in embedded contexts: show the URL for manual copying.
      prompt(TG.copyLink, url)
    }
  })
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
  const mapRow = root.querySelector('#lobby-map') as HTMLElement
  const mapLabel = root.querySelector('#map-label') as HTMLElement
  const mapPips = root.querySelector('#map-pips') as HTMLElement
  mapPips.innerHTML = '<i class="px-xs"></i>'.repeat(MAP_COUNT)
  const mapMinus = root.querySelector('#map-minus') as HTMLButtonElement
  const mapPlus = root.querySelector('#map-plus') as HTMLButtonElement
  const mapCanvas = root.querySelector('#map-canvas') as HTMLCanvasElement
  const mapCtx = mapCanvas.getContext('2d')!
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
  mapMinus.addEventListener('click', () => {
    if (last) onMap?.((last.mapIndex - 1 + MAP_COUNT) % MAP_COUNT)
  })
  mapPlus.addEventListener('click', () => {
    if (last) onMap?.((last.mapIndex + 1) % MAP_COUNT)
  })

  const paintMinimap = (mapIndex: number) => {
    const map = MAPS[mapIndex]
    if (!map) return
    // 16px per tile internally (the CSS box only ever downscales), 20:11 like the arena.
    mapCanvas.width = 640
    mapCanvas.height = 352
    drawMinimap(mapCtx, map, 640, 352)
    mapPips.querySelectorAll('i').forEach((pip, i) => pip.classList.toggle('on', i === mapIndex))
  }

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
        title.textContent = view.isPrivate ? TG.yourRoom : TG.finding
        codeEl.hidden = !view.isPrivate
        inviteBtn.hidden = !view.isPrivate
        codeVal.textContent = view.code
        countEl.textContent = view.isPrivate ? `${view.humans} / 12 ${TG.players}` : `${view.humans} ${TG.joined}`
        botsRow.hidden = !(view.isPrivate && view.isHost)
        botsLabel.textContent = `${TG.bots}: ${view.bots}`
        minsRow.hidden = !(view.isPrivate && view.isHost)
        minsLabel.textContent = `${TG.round}: ${view.roundMins} ${TG.min}`
        mapRow.hidden = false // Everyone sees the map preview…
        // …but only a private room's host can change it — the server rejects MSG.Map from
        // guests and from public rooms, so nobody gets arrows that silently do nothing.
        const canPickMap = view.isPrivate && view.isHost
        mapMinus.style.visibility = canPickMap ? 'visible' : 'hidden'
        mapPlus.style.visibility = mapMinus.style.visibility
        mapLabel.textContent = `${MAPS[view.mapIndex]?.name?.toUpperCase() ?? 'UNKNOWN'} · ${MONSTER_NAMES[view.mapIndex] ?? ''}`
        paintMinimap(view.mapIndex)
        // Bots count toward a startable round: a solo host plus one bot is a real game,
        // and the bots +/- control they are shown must be able to take effect.
        const canStart = view.humans + view.bots >= 2
        startBtn.hidden = !(view.isPrivate && view.isHost)
        startBtn.disabled = !canStart
        hint.textContent = view.isPrivate
          ? view.isHost
            ? canStart
              ? TG.hintCanStart(seats, view.roundMins, view.humans)
              : TG.hintNeedOne
            : TG.hintWaitHost(view.roundMins)
          : TG.hintPublic(view.humans)
        // Portal usernames (CrazyGames) sit beside the square so friends find each other.
        roster.innerHTML = view.scores
          .map(
            (p) =>
              `<span class="lobby-who"><span class="lobby-dot px-xs${p.isBot ? ' bot' : ''}" style="background:${hex(PLAYER_COLORS[p.colorSlot % PLAYER_COLORS.length]!)}"></span>${nameTag(p.name)}</span>`,
          )
          .join('')
      } else {
        title.textContent = TG.roundOver
        codeEl.hidden = true
        inviteBtn.hidden = true
        startBtn.hidden = true
        botsRow.hidden = true
        minsRow.hidden = true
        mapRow.hidden = true
        hint.textContent = TG.hintResults
        // Winner = least It-time (#1). Loser = most — but only when strictly worst, so a
        // full-room tie never brands an arbitrary player.
        const worst = view.scores[view.scores.length - 1]
        const secondWorst = view.scores[view.scores.length - 2]
        roster.innerHTML = view.scores
          .map((p, i) => {
            const tag =
              i === 0 && view.scores.length > 1
                ? `<span class="lobby-tag px-xs win">${TG.winner}</span>`
                : i === view.scores.length - 1 && secondWorst && worst!.itTimeMs > secondWorst.itTimeMs
                  ? `<span class="lobby-tag px-xs lose">${TG.lost}</span>`
                  : ''
            return (
              `<div class="lobby-row"><span class="who">` +
              `<span class="lobby-dot${p.isBot ? ' bot' : ''}" style="background:${hex(PLAYER_COLORS[p.colorSlot % PLAYER_COLORS.length]!)}"></span>` +
              `#${i + 1}${p.name ? ` · ${esc(p.name)}` : ''}${p.isBot ? ` · ${TG.bot}` : ''}</span>` +
              `<span>${tag} ${p.caught > 0 ? `<span style="opacity:.6">${TG.caught} ${p.caught}x · </span>` : ''}${(p.itTimeMs / 1000).toFixed(1)}s</span></div>`
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
