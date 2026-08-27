import { CHAT_ICON, CLOSE_ICON, SEND_ICON, drawIconToCanvas } from './render/pixelIcons.ts'

/**
 * The room chat — multiplayer only, relay only, remembered by nobody.
 *
 * A pixel-bubble button sits at the left edge; tapping it slides a translucent panel in
 * from the left (the Genshin pattern, restyled to this game's chunky pixel register:
 * hard corners, thick chalk borders, monospace text, a hard drop shadow, 0.8 opacity so
 * the arena stays visible behind it). Players are identified by their avatar colour —
 * the game has no names, so the colour IS the identity, exactly as it is for trails.
 *
 * Engine-owned DOM, like the toolbar and the HUD timer: chat events are rare, so nothing
 * here touches React or the render loop. Messages live only in this DOM list (capped at
 * the last 60) and die with the page — there is no history, by design. All text lands via
 * `textContent`, so a chatty player cannot inject markup into anyone's page.
 */

export interface ChatUi {
  /** Appends a received line. Safe to call while the panel is closed (arms the badge). */
  push(slot: number, text: string): void
  destroy(): void
}

/** Colour names for chat identity, indexed by colorSlot — mirrors PLAYER_COLORS. */
export const COLOR_NAMES = [
  'ROSE',
  'SKY',
  'LEAF',
  'APRICOT',
  'LILAC',
  'BUTTER',
  'CORAL',
  'MINT',
  'PERI',
  'ORCHID',
  'SAGE',
  'BLUSH',
] as const

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

const CHALK_BORDER = '2px solid rgba(255,243,220,.28)'
const FONT = "12px ui-monospace, Menlo, Consolas, monospace"

export const createChatUi = (opts: {
  send(text: string): void
  /** Colour slot for a player slot, resolved at render time (colours are per-round). */
  colorSlotOf(slot: number): number
  colorOf(colorSlot: number): number
  mySlot(): number
}): ChatUi => {
  const stop = (e: Event): void => e.stopPropagation()

  // ── The bubble button ──
  const button = document.createElement('button')
  button.id = 'chat-btn'
  button.style.cssText =
    'position:fixed;top:calc(14px + env(safe-area-inset-top));left:calc(12px + env(safe-area-inset-left));' +
    'width:52px;height:52px;padding:0;display:flex;align-items:center;justify-content:center;' +
    `background:rgba(22,18,38,.72);border:${CHALK_BORDER};border-radius:0;z-index:50;` +
    'touch-action:none;cursor:pointer;box-shadow:3px 3px 0 rgba(0,0,0,.4);user-select:none;-webkit-user-select:none;'
  const buttonCanvas = document.createElement('canvas')
  buttonCanvas.width = 44
  buttonCanvas.height = 44
  buttonCanvas.style.cssText = 'width:44px;height:44px;image-rendering:pixelated;'
  drawIconToCanvas(buttonCanvas, CHAT_ICON, 4)
  button.appendChild(buttonCanvas)
  // Unread badge: one fat gold pixel.
  const badge = document.createElement('div')
  badge.style.cssText =
    'position:absolute;top:-5px;right:-5px;width:12px;height:12px;background:#e8c56a;' +
    'border:2px solid #161226;display:none;'
  button.appendChild(badge)

  // ── The panel ──
  const panel = document.createElement('div')
  panel.id = 'chat-panel'
  panel.style.cssText =
    'position:fixed;top:0;bottom:0;left:0;width:min(340px, 86vw);z-index:51;display:flex;flex-direction:column;' +
    'background:rgba(16,12,30,.8);border-right:' +
    CHALK_BORDER +
    ';box-shadow:4px 0 0 rgba(0,0,0,.35);transform:translateX(-110%);transition:transform .16s ease-out;' +
    'padding-left:env(safe-area-inset-left);padding-top:env(safe-area-inset-top);' +
    'padding-bottom:env(safe-area-inset-bottom);user-select:text;'

  const header = document.createElement('div')
  header.style.cssText =
    `display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:${CHALK_BORDER};`
  const title = document.createElement('div')
  title.textContent = 'ROOM CHAT'
  title.style.cssText = `font:${FONT};font-weight:700;letter-spacing:2px;color:#fff3dc;`
  const closeBtn = document.createElement('button')
  closeBtn.style.cssText =
    'width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;' +
    `background:transparent;border:${CHALK_BORDER};border-radius:0;cursor:pointer;`
  const closeCanvas = document.createElement('canvas')
  closeCanvas.width = 24
  closeCanvas.height = 24
  closeCanvas.style.cssText = 'width:24px;height:24px;image-rendering:pixelated;'
  drawIconToCanvas(closeCanvas, CLOSE_ICON, 3)
  closeBtn.appendChild(closeCanvas)
  header.append(title, closeBtn)

  const list = document.createElement('div')
  list.style.cssText =
    `flex:1;overflow-y:auto;padding:10px 12px;font:${FONT};line-height:1.65;color:#e8e2f4;` +
    '-webkit-overflow-scrolling:touch;overscroll-behavior:contain;'
  const hint = document.createElement('div')
  hint.textContent = 'say something — nothing here is saved.'
  hint.style.cssText = 'opacity:.45;'
  list.appendChild(hint)

  const inputRow = document.createElement('div')
  inputRow.style.cssText = `display:flex;gap:8px;padding:10px 12px;border-top:${CHALK_BORDER};`
  const input = document.createElement('input')
  input.type = 'text'
  input.maxLength = 120
  input.placeholder = '...'
  input.autocomplete = 'off'
  // 16px minimum or iOS zooms the whole page on focus.
  input.style.cssText =
    'flex:1;min-width:0;font:16px ui-monospace, Menlo, Consolas, monospace;color:#fff;' +
    `background:rgba(255,255,255,.07);border:${CHALK_BORDER};border-radius:0;padding:8px 10px;outline:none;`
  const sendBtn = document.createElement('button')
  sendBtn.style.cssText =
    'width:44px;height:44px;flex:none;padding:0;display:flex;align-items:center;justify-content:center;' +
    `background:rgba(22,18,38,.72);border:${CHALK_BORDER};border-radius:0;cursor:pointer;`
  const sendCanvas = document.createElement('canvas')
  sendCanvas.width = 28
  sendCanvas.height = 28
  sendCanvas.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;'
  drawIconToCanvas(sendCanvas, SEND_ICON, 3)
  sendBtn.appendChild(sendCanvas)
  inputRow.append(input, sendBtn)

  panel.append(header, list, inputRow)
  document.body.append(button, panel)

  // Chat surfaces must never leak pointer events into the joystick underneath.
  for (const el of [button, panel]) el.addEventListener('pointerdown', stop)

  let open = false
  const setOpen = (v: boolean): void => {
    open = v
    panel.style.transform = v ? 'translateX(0)' : 'translateX(-110%)'
    if (v) {
      badge.style.display = 'none'
      input.focus()
    } else {
      input.blur()
    }
  }
  button.addEventListener('pointerdown', () => setOpen(!open))
  closeBtn.addEventListener('pointerdown', () => setOpen(false))

  // The server rate-limits to one line per 600ms and silently drops the excess. Pace
  // sends here so a quick second line is delayed, never lost.
  let nextSendAt = 0
  const submit = (): void => {
    const text = input.value.trim()
    if (text.length === 0) return
    input.value = ''
    const now = performance.now()
    const at = Math.max(now, nextSendAt)
    nextSendAt = at + 620
    if (at <= now) opts.send(text)
    else setTimeout(() => opts.send(text), at - now)
  }
  sendBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault() // keep focus in the input so the mobile keyboard stays up
    submit()
  })
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') submit()
    else if (e.key === 'Escape') setOpen(false)
    e.stopPropagation()
  }
  input.addEventListener('keydown', onKey)

  return {
    push(slot: number, text: string): void {
      if (hint.parentNode) hint.remove()
      const colorSlot = opts.colorSlotOf(slot)
      const row = document.createElement('div')
      const swatch = document.createElement('span')
      swatch.style.cssText =
        `display:inline-block;width:9px;height:9px;margin-right:6px;background:${css(opts.colorOf(colorSlot))};`
      const name = document.createElement('span')
      name.textContent = `${COLOR_NAMES[colorSlot % COLOR_NAMES.length]}${slot === opts.mySlot() ? ' (YOU)' : ''}  `
      name.style.cssText = `color:${css(opts.colorOf(colorSlot))};font-weight:700;letter-spacing:1px;`
      const body = document.createElement('span')
      body.textContent = text // textContent, always: no markup ever executes
      row.append(swatch, name, body)
      const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40
      list.appendChild(row)
      while (list.childElementCount > 60) list.firstElementChild?.remove()
      if (nearBottom) list.scrollTop = list.scrollHeight
      if (!open) badge.style.display = 'block'
    },
    destroy(): void {
      button.remove()
      panel.remove()
    },
  }
}
