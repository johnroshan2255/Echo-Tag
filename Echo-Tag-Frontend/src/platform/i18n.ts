/**
 * BOOT-chunk strings only: the menu and its error states, in the eight languages that
 * cover most web-portal traffic. The lobby/game/banner strings live in i18nGame.ts —
 * they ship with the game chunk, keeping the boot chunk inside its 16KB budget.
 *
 * The language comes from the browser (`navigator.language`), overridable with ?lang=xx
 * for testing. Unknown languages fall back to English per-key (spread merge).
 */

const EN = {
  play: 'PLAY',
  quick: 'QUICK MATCH',
  host: 'HOST ROOM',
  join: 'JOIN',
  codePlaceholder: 'CODE',
  tagline: "Don't be It when the clock runs out.",
  loading: 'LOADING',
  retry: 'RETRY',
  errLoad: 'Could not load the game. Check your connection.',
  errFull: 'That room is full right now — try again in a moment.',
  errNoRoom: 'No room with that code. Check it and try again.',
  errServer: 'Could not reach the game server — try PLAY for a bots round.',
  errCodeLen: 'Room codes are five letters.',
  rejoining: 'Rejoining room',
}

export type BootStrings = typeof EN

const TABLES: Record<string, Partial<BootStrings>> = {
  en: {},
  pt: {
    play: 'JOGAR',
    quick: 'PARTIDA RAPIDA',
    host: 'CRIAR SALA',
    join: 'ENTRAR',
    codePlaceholder: 'CODIGO',
    tagline: 'Não seja o monstro quando o tempo acabar.',
    loading: 'CARREGANDO',
    retry: 'TENTAR DE NOVO',
    errLoad: 'Não foi possível carregar o jogo. Verifique sua conexão.',
    errFull: 'Essa sala está cheia — tente de novo em instantes.',
    errNoRoom: 'Nenhuma sala com esse código. Confira e tente de novo.',
    errServer: 'Servidor fora do ar — toque em JOGAR para uma partida com bots.',
    errCodeLen: 'Os códigos têm cinco letras.',
    rejoining: 'Voltando para a sala',
  },
  es: {
    play: 'JUGAR',
    quick: 'PARTIDA RAPIDA',
    host: 'CREAR SALA',
    join: 'UNIRSE',
    codePlaceholder: 'CODIGO',
    tagline: 'No seas el monstruo cuando acabe el tiempo.',
    loading: 'CARGANDO',
    retry: 'REINTENTAR',
    errLoad: 'No se pudo cargar el juego. Revisa tu conexión.',
    errFull: 'Esa sala está llena — inténtalo de nuevo en un momento.',
    errNoRoom: 'No hay sala con ese código. Revísalo e inténtalo de nuevo.',
    errServer: 'No hay conexión con el servidor — prueba JUGAR con bots.',
    errCodeLen: 'Los códigos tienen cinco letras.',
    rejoining: 'Volviendo a la sala',
  },
  tr: {
    play: 'OYNA',
    quick: 'HIZLI OYUN',
    host: 'ODA KUR',
    join: 'KATIL',
    codePlaceholder: 'KOD',
    tagline: 'Süre bittiğinde canavar sen olma.',
    loading: 'YÜKLENİYOR',
    retry: 'TEKRAR DENE',
    errLoad: 'Oyun yüklenemedi. Bağlantını kontrol et.',
    errFull: 'Bu oda şu an dolu — birazdan tekrar dene.',
    errNoRoom: 'Bu kodla bir oda yok. Kontrol edip tekrar dene.',
    errServer: 'Sunucuya ulaşılamadı — botlarla oynamak için OYNA.',
    errCodeLen: 'Oda kodları beş harflidir.',
    rejoining: 'Odaya dönülüyor',
  },
  id: {
    play: 'MAIN',
    quick: 'MAIN CEPAT',
    host: 'BUAT ROOM',
    join: 'GABUNG',
    codePlaceholder: 'KODE',
    tagline: 'Jangan jadi monster saat waktu habis.',
    loading: 'MEMUAT',
    retry: 'COBA LAGI',
    errLoad: 'Gagal memuat game. Periksa koneksimu.',
    errFull: 'Room itu sedang penuh — coba lagi sebentar lagi.',
    errNoRoom: 'Tidak ada room dengan kode itu. Periksa lalu coba lagi.',
    errServer: 'Server tidak terjangkau — tekan MAIN untuk ronde bot.',
    errCodeLen: 'Kode room terdiri dari lima huruf.',
    rejoining: 'Kembali ke room',
  },
  ru: {
    play: 'ИГРАТЬ',
    quick: 'БЫСТРАЯ ИГРА',
    host: 'СОЗДАТЬ КОМНАТУ',
    join: 'ВОЙТИ',
    codePlaceholder: 'КОД',
    tagline: 'Не будь монстром, когда время выйдет.',
    loading: 'ЗАГРУЗКА',
    retry: 'ЕЩЁ РАЗ',
    errLoad: 'Не удалось загрузить игру. Проверь соединение.',
    errFull: 'Комната сейчас заполнена — попробуй чуть позже.',
    errNoRoom: 'Комнаты с таким кодом нет. Проверь и попробуй снова.',
    errServer: 'Сервер недоступен — нажми ИГРАТЬ для раунда с ботами.',
    errCodeLen: 'Код комнаты — пять букв.',
    rejoining: 'Возвращение в комнату',
  },
  de: {
    play: 'SPIELEN',
    quick: 'SCHNELLES SPIEL',
    host: 'RAUM ERSTELLEN',
    join: 'BEITRETEN',
    codePlaceholder: 'CODE',
    tagline: 'Sei nicht das Monster, wenn die Zeit abläuft.',
    loading: 'LÄDT',
    retry: 'NOCHMAL',
    errLoad: 'Spiel konnte nicht geladen werden. Prüfe deine Verbindung.',
    errFull: 'Dieser Raum ist gerade voll — versuche es gleich nochmal.',
    errNoRoom: 'Kein Raum mit diesem Code. Prüfe ihn und versuche es erneut.',
    errServer: 'Server nicht erreichbar — SPIELEN startet eine Bot-Runde.',
    errCodeLen: 'Raumcodes haben fünf Buchstaben.',
    rejoining: 'Zurück in Raum',
  },
  fr: {
    play: 'JOUER',
    quick: 'PARTIE RAPIDE',
    host: 'CRÉER UN SALON',
    join: 'REJOINDRE',
    codePlaceholder: 'CODE',
    tagline: "Ne sois pas le monstre quand le temps s'écoule.",
    loading: 'CHARGEMENT',
    retry: 'RÉESSAYER',
    errLoad: 'Impossible de charger le jeu. Vérifie ta connexion.',
    errFull: 'Ce salon est plein — réessaie dans un instant.',
    errNoRoom: 'Aucun salon avec ce code. Vérifie-le et réessaie.',
    errServer: 'Serveur injoignable — JOUER lance une partie avec des bots.',
    errCodeLen: 'Les codes font cinq lettres.',
    rejoining: 'Retour dans le salon',
  },
}

const pickLang = (): string => {
  try {
    const forced = new URLSearchParams(globalThis.location?.search ?? '').get('lang')
    if (forced && forced in TABLES) return forced
    const nav = (globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? 'en').toLowerCase()
    const short = nav.split('-')[0]!
    if (short in TABLES) return short
  } catch {
    /* no navigator (tests) → English */
  }
  return 'en'
}

export const LANG: string = pickLang()

/** The boot strings, in the player's language, English filling any gap. */
export const T: BootStrings = { ...EN, ...TABLES[LANG] }
