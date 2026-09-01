import musicUrl from '../../sounds/menu-music.mp3'

/**
 * The menu & lobby music: "Spooky Dungeon" by Memoraphile @ You're Perfect Studio
 * (opengameart.org/content/spooky-dungeon, CC0) — a loopable 8-bit dungeon tune, the
 * exact register of the game's pixel dusk.
 *
 * One HTMLAudioElement, shared by the boot menu and the game chunk (same module graph):
 * the menu starts it on the first gesture, the game keeps it for the LOBBY and the
 * results board, and pauses it the moment a round is actually being played — the round
 * belongs to the synthesised soundscape. The file is fetched lazily by the browser when
 * the element first plays, so it never gates the boot budget.
 */

let el: HTMLAudioElement | null = null
let muted = false
let wanted = false // does the current screen want music (menu/lobby yes, round no)

const sync = (): void => {
  if (!el) return
  if (wanted && !muted && !document.hidden) {
    void el.play().catch(() => {
      /* not unlocked yet — the next gesture-driven call will land */
    })
  } else {
    el.pause()
  }
}

// Hidden tab: silence, like everything else in the game.
document.addEventListener('visibilitychange', sync)

/** Ask for music (menu shown, lobby entered). Safe to call repeatedly. */
export const playMusic = (): void => {
  if (!el) {
    el = new Audio(musicUrl)
    el.loop = true
    el.volume = 0.55
  }
  wanted = true
  sync()
}

/** The round started (or the game wants quiet): stop, but remember nothing — the next
 * playMusic resumes the loop. */
export const pauseMusic = (): void => {
  wanted = false
  el?.pause()
}

/** The player's mute button and Poki ad breaks both route through here. */
export const setMusicMuted = (m: boolean): void => {
  muted = m
  sync()
}
