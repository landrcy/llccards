# LLC Cards

A minimalist black-and-white browser TCG. The only color is the foil sheen on rare pulls.

Playable: title, map, shop, Edition One and Edition Two packs, a binder, and the arena (duel a bot on Easy, Normal or Hard, quick match online, or a 4-letter room code for a friend).

## Duels

Yu-Gi-Oh-style, 4000 LP each, 20-card deck built from your binder (3 copies of each monster/spell you own, max 2 of each trap; starters fill the rest). Phases: draw, main, battle, end. Two normal summons per turn, in attack or defense mode (tribute summons count, special summons do not). Edition Two fusions live in a 2-card Hangar: from turn 2, MECH LINK sends the listed materials you control and special summons the fusion (once per turn, not a normal summon). **Monsters are always face-up**: "set" means face-up defense mode (card turned sideways, DEF shown). Only spells and traps are set face-down. 5-star monsters need 1 tribute. Monsters can't attack the turn they're played (except Stick Runner) and nobody attacks on turn 1.

Traps fire on the opponent's attack, **at most one trap per player per turn**. SMUDGE (2★): the attacker loses 300 ATK this turn. WHOOPS! (4★, rarer): pay 300 LP to stop an attack by a monster with 1500+ ATK.

Board: hover or tap any card to read it in the detail panel (desktop) or sheet (phone); every attack draws an arrow and shows a clash pop-up (tap to skip); the battle log keeps the last 40 events. Tap either GRAVE pile to browse that graveyard, newest first. When you must discard, your hand turns red with a pulsing DISCARD label: tap a card to mark it with a red X, tap again (or THROW IT AWAY) to send it to the graveyard. Red is the one deliberate exception to black and white.

Rules live in `js/engine.js` (pure, host-authoritative), the bot in `js/ai.js`, the board in `js/duel.js`. Online play is WebRTC peer-to-peer through the free PeerJS cloud signalling server (`js/net.js`, PeerJS vendored under MIT). The host runs the rules and sends each player a redacted view, so you never receive the other hand. A protocol version check refuses to start a match between two different cached builds (both players are told to refresh), and the board ignores taps while an action is in flight or an animation is playing.

## Audio

Real downloaded CC0 files only (Kenney, omfgdude, qubodup, Luckius). Map/shop music: "Chill lofi inspired [loop edit]" (omfgdude, loop edit by qubodup); battle music: "Lofi Hip Hop Loop" (omfgdude). Nothing is synthesised. See [`assets/audio/CREDITS.txt`](assets/audio/CREDITS.txt). Audio starts on the first tap, and the mute toggle is remembered.

Open [the live page](https://landrcy.github.io/llccards/) or just open `index.html` from a local static server (needed so card masks and the font load correctly).

## Type

On-screen type (UI and card lettering) is **LLC Hand**, a pixel-outline webfont traced from Finley's font sheet (`assets/fonts/LLCHand-Regular.woff2`, `.ttf`).

The logo and card back are Landry's drawings, cleaned to 1-bit.

## Debug

- `?foil=1` — every pulled card is foil
- `?seed=123` — reproducible pack
- `?shot=title|map|shop|arena|opening|mid|new|foil|binder` — jump to a staged screen
- `?screen=arena` — open a screen directly
- Reset collection buttons in the shop and binder
