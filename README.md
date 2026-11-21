# LLC Cards

A minimalist black-and-white browser TCG. The only color is the foil sheen on rare pulls.

Playable: title, map, shop, Edition One pack opening, a 10-slot binder, and the arena (duel a bot, quick match online, or a 4-letter room code for a friend).

## Duels

Yu-Gi-Oh-style, 4000 LP each, 20-card deck built from your binder (3 copies of each card you own, starters fill the rest). Phases: draw, main, battle, end. One normal summon or set per turn, 5-star monsters need 1 tribute, spells and traps can be set, traps fire on the opponent's attack. Monsters can't attack the turn they're played (except Stick Runner) and nobody attacks on turn 1.

Rules live in `js/engine.js` (pure, host-authoritative), the bot in `js/ai.js`, the board in `js/duel.js`. Online play is WebRTC peer-to-peer through the free PeerJS cloud signalling server (`js/net.js`, PeerJS vendored under MIT). The host runs the rules and sends each player a redacted view, so you never receive the other hand.

## Audio

Real downloaded CC0 files only (Kenney, omfgdude, qubodup, Luckius). Nothing is synthesised. See [`assets/audio/CREDITS.txt`](assets/audio/CREDITS.txt). Audio starts on the first tap, and the mute toggle is remembered.

Open [the live page](https://landrcy.github.io/llccards/) or just open `index.html` from a local static server (needed so card masks and the font load correctly).

## Type

On-screen type is **Bagel Fat One** (Regular) by Kyungwon Kim and JAMO, licensed under the SIL Open Font License 1.1. See [`assets/fonts/OFL-BagelFatOne.txt`](assets/fonts/OFL-BagelFatOne.txt) and [`assets/fonts/LICENSE.txt`](assets/fonts/LICENSE.txt). Free for personal and commercial use; the font may be embedded in a website or app, but may not be sold on its own.

The named Pixel Paint font could not be found. Bagel Fat One replaced an earlier Ms Paint Mouse stand-in so the lettering is closer to the chunky rounded marker in Landry's logo.

The logo and card back are Landry's drawings, cleaned to 1-bit.

## Debug

- `?foil=1` — every pulled card is foil
- `?seed=123` — reproducible pack
- `?shot=title|map|shop|arena|opening|mid|new|foil|binder` — jump to a staged screen
- `?screen=arena` — open a screen directly
- Reset collection buttons in the shop and binder
