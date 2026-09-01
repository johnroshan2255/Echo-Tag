import { LANG, T } from '../platform/i18n.ts'

/**
 * The HOW TO PLAY overlay, behind the menu's ⓘ button.
 *
 * Lazy-loaded on the first tap (dynamic import in main.ts) so its eight languages of
 * rules text never touch the 16KB boot budget — the button costs bytes, the lesson
 * doesn't. Styled in the menu's own language: hard corners, dusk palette, a coloured
 * square bullet per rule — the same bricks the game is built from.
 */

interface HowStrings {
  rules: string[]
  ok: string
}

const EN: HowStrings = {
  rules: [
    'One of you is It — the monster. Tag someone to pass the curse on. Whoever spends the least time as the monster wins the round.',
    "The monster's last seconds of movement linger in the air as a solid echo trail. Don't get walled in.",
    'Every world is haunted by its own monster: the manor ghost, the forest wraith, the cave spider (webs!), the hive alien (dodge the ray!).',
    'The world hunts too: nest spiders and UFOs snatch anyone who wanders close. Struggle to break free.',
    'Hide in wardrobes, warp through portals, slip through doors — but hinges creak, and everyone hears.',
    'Move with WASD, the arrows or the touch stick. As the monster, SPACE (or the on-screen button) fires your power.',
  ],
  ok: 'GOT IT',
}

const TABLES: Record<string, HowStrings> = {
  en: EN,
  pt: {
    rules: [
      'Um de vocês é o monstro. Toque em alguém para passar a maldição. Quem ficar menos tempo como monstro vence a rodada.',
      'Os últimos segundos de movimento do monstro ficam no ar como um rastro sólido. Não fique encurralado.',
      'Cada mundo tem seu próprio monstro: o fantasma da mansão, o espectro da floresta, a aranha da caverna (teias!), o alien da colmeia (desvie do raio!).',
      'O mundo também caça: aranhas de ninho e OVNIs agarram quem chega perto. Lute para se soltar.',
      'Esconda-se em armários, use os portais, passe pelas portas — mas as dobradiças rangem, e todos ouvem.',
      'Mova com WASD, as setas ou o joystick na tela. Como monstro, ESPAÇO (ou o botão na tela) dispara seu poder.',
    ],
    ok: 'ENTENDI',
  },
  es: {
    rules: [
      'Uno de ustedes es el monstruo. Toca a otro para pasarle la maldición. Gana quien pase menos tiempo como monstruo.',
      'Los últimos segundos de movimiento del monstruo quedan en el aire como un rastro sólido. Que no te acorralen.',
      'Cada mundo tiene su propio monstruo: el fantasma de la mansión, el espectro del bosque, la araña de la cueva (¡telarañas!), el alien de la colmena (¡esquiva el rayo!).',
      'El mundo también caza: arañas de nido y ovnis atrapan a quien se acerca. Forcejea para soltarte.',
      'Escóndete en armarios, cruza portales, pasa por puertas — pero las bisagras chirrían, y todos oyen.',
      'Muévete con WASD, las flechas o el joystick táctil. Como monstruo, ESPACIO (o el botón en pantalla) dispara tu poder.',
    ],
    ok: 'ENTENDIDO',
  },
  tr: {
    rules: [
      'Biriniz canavardır — Ebe. Laneti devretmek için birine dokun. Canavar olarak en az süre geçiren turu kazanır.',
      'Canavarın son birkaç saniyelik hareketi havada katı bir iz olarak asılı kalır. Köşeye sıkışma.',
      'Her dünyanın kendi canavarı var: konak hayaleti, orman hortlağı, mağara örümceği (ağlar!), kovan uzaylısı (ışından kaç!).',
      "Dünya da avlanır: yuva örümcekleri ve UFO'lar yaklaşanı kapar. Kurtulmak için çırpın.",
      'Dolaplara saklan, portallardan geç, kapılardan süzül — ama menteşeler gıcırdar ve herkes duyar.',
      'WASD, ok tuşları ya da dokunmatik çubukla hareket et. Canavarken gücünü BOŞLUK (ya da ekrandaki düğme) ateşler.',
    ],
    ok: 'ANLADIM',
  },
  id: {
    rules: [
      'Salah satu dari kalian adalah monster. Sentuh pemain lain untuk mengoper kutukan. Yang paling sebentar jadi monster menang.',
      'Beberapa detik gerakan terakhir monster tertinggal di udara sebagai jejak padat. Jangan sampai terkurung.',
      'Tiap dunia punya monsternya sendiri: hantu rumah besar, wraith hutan, laba-laba gua (jaring!), alien sarang (hindari sinarnya!).',
      'Dunianya juga berburu: laba-laba sarang dan UFO menangkap siapa pun yang mendekat. Berontak untuk lepas.',
      'Sembunyi di lemari, lewat portal, selinap lewat pintu — tapi engselnya berderit, dan semua mendengar.',
      'Bergerak dengan WASD, panah, atau stik sentuh. Saat jadi monster, SPASI (atau tombol di layar) melepaskan kekuatanmu.',
    ],
    ok: 'MENGERTI',
  },
  ru: {
    rules: [
      'Один из вас — монстр. Осаль другого, чтобы передать проклятие. Побеждает тот, кто меньше всех пробыл монстром.',
      'Последние секунды движения монстра застывают в воздухе плотным следом-эхом. Не дай себя запереть.',
      'В каждом мире свой монстр: призрак поместья, лесной дух, пещерный паук (паутина!), пришелец из улья (уклоняйся от луча!).',
      'Мир тоже охотится: гнездовые пауки и НЛО хватают тех, кто подойдёт близко. Вырывайся из хватки.',
      'Прячься в шкафах, ныряй в порталы, проскальзывай в двери — но петли скрипят, и все это слышат.',
      'Движение: WASD, стрелки или стик на экране. Сила монстра — ПРОБЕЛ или кнопка на экране.',
    ],
    ok: 'ПОНЯТНО',
  },
  de: {
    rules: [
      'Einer von euch ist das Monster. Berühre jemanden, um den Fluch weiterzugeben. Wer am kürzesten Monster war, gewinnt die Runde.',
      'Die letzten Sekunden der Monster-Bewegung bleiben als feste Echo-Spur in der Luft. Lass dich nicht einmauern.',
      'Jede Welt hat ihr eigenes Monster: der Geist der Villa, der Waldschemen, die Höhlenspinne (Netze!), der Hive-Alien (weich dem Strahl aus!).',
      'Die Welt jagt mit: Nestspinnen und UFOs schnappen sich, wer zu nahe kommt. Wehr dich, um freizukommen.',
      'Versteck dich in Schränken, spring durch Portale, schlüpf durch Türen — aber Scharniere knarren, und alle hören es.',
      'Bewegen: WASD, Pfeile oder Touch-Stick. Als Monster feuert die LEERTASTE (oder der Bildschirm-Button) deine Kraft.',
    ],
    ok: 'ALLES KLAR',
  },
  fr: {
    rules: [
      "L'un de vous est le monstre. Touchez quelqu'un pour transmettre la malédiction. Qui reste monstre le moins longtemps gagne.",
      "Les dernières secondes de mouvement du monstre restent figées en un sillage d'écho solide. Ne te laisse pas emmurer.",
      "Chaque monde a son monstre : le fantôme du manoir, le spectre de la forêt, l'araignée de la grotte (toiles !), l'alien de la ruche (esquive le rayon !).",
      "Le monde chasse aussi : araignées de nid et ovnis attrapent qui s'approche. Débats-toi pour te libérer.",
      'Cache-toi dans les armoires, passe par les portails, faufile-toi par les portes — mais les gonds grincent, et tout le monde entend.',
      "Déplacement : WASD, flèches ou stick tactile. En monstre, ESPACE (ou le bouton à l'écran) déclenche ton pouvoir.",
    ],
    ok: 'COMPRIS',
  },
}

/** One coloured square per rule — the cast's own colours, so the list teaches twice. */
const BULLETS = ['#ffc07a', '#cfc5e8', '#a8d890', '#2fd4b8', '#ff85ad', '#e9ddff']

export const showHowTo = (): void => {
  if (document.getElementById('howto')) return
  const S = TABLES[LANG] ?? EN

  const overlay = document.createElement('div')
  overlay.id = 'howto'
  overlay.innerHTML = `
    <style>
      #howto { position: fixed; inset: 0; z-index: 3; display: grid; place-items: center;
        background: rgba(10,7,20,.72); pointer-events: auto; }
      #howto-panel { width: min(92vw, 460px); max-height: min(84vh, 84svh); overflow-y: auto;
        background: #1d1830; border: 3px solid #3a3150; box-shadow: 6px 6px 0 rgba(0,0,0,.45);
        padding: 16px 18px calc(16px + env(safe-area-inset-bottom)); }
      #howto-head { display: flex; align-items: center; justify-content: space-between;
        gap: 10px; margin: 0 0 10px; }
      #howto-head h2 { margin: 0; color: #ffc07a; font: 900 17px/1 system-ui, sans-serif;
        letter-spacing: .18em; }
      #howto-x { cursor: pointer; border: 3px solid #3a3150; background: #262048;
        color: #e9ddff; width: 36px; height: 36px; font: 800 15px/1 ui-monospace, monospace; }
      #howto-x:active { background: #3a3150; }
      #howto ul { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 10px; }
      #howto li { position: relative; padding-left: 22px;
        font: 600 13.5px/1.45 system-ui, sans-serif; color: #d9cfee; }
      #howto li::before { content: ''; position: absolute; left: 0; top: 4px;
        width: 11px; height: 11px; background: var(--c); }
      #howto-ok { display: block; margin: 0 auto; cursor: pointer; border: 0;
        padding: 12px 34px; color: #241505; background: #ffc07a;
        font: 800 15px/1 system-ui, sans-serif; letter-spacing: .12em;
        box-shadow: 4px 4px 0 rgba(0,0,0,.4); }
      #howto-ok:active { transform: translate(2px,2px); box-shadow: 2px 2px 0 rgba(0,0,0,.4); }
    </style>
    <div id="howto-panel" role="dialog" aria-modal="true" aria-label="${T.how}">
      <div id="howto-head"><h2>${T.how}</h2><button id="howto-x" type="button" aria-label="close">✕</button></div>
      <ul>${S.rules.map((r, i) => `<li style="--c:${BULLETS[i]}">${r}</li>`).join('')}</ul>
      <button id="howto-ok" type="button">${S.ok}</button>
    </div>`

  const close = (): void => {
    removeEventListener('keydown', onKey)
    overlay.remove()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  addEventListener('keydown', onKey)
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close() // tap the dark: dismissed
  })
  overlay.querySelector('#howto-x')!.addEventListener('click', close)
  overlay.querySelector('#howto-ok')!.addEventListener('click', close)

  // #ui, not #menu: the overlay must sit above the menu, and outlive nothing — closing
  // removes it entirely, and starting the game removes #menu around it either way.
  document.getElementById('ui')!.appendChild(overlay)
  ;(overlay.querySelector('#howto-ok') as HTMLButtonElement).focus()
}
