# LLC Cards

A minimalist black-and-white browser TCG. The only color is the foil sheen on rare pulls.

This is an early playable build: title, map, shop, Edition One pack opening, and a binder. Battle is coming soon.

Open [the live page](https://landrcy.github.io/llc-cards/) or just open `index.html` from a local static server (needed so card masks and the font load correctly).

## Type

On-screen type is **Bagel Fat One** (Regular) by Kyungwon Kim and JAMO, licensed under the SIL Open Font License 1.1. See [`assets/fonts/OFL-BagelFatOne.txt`](assets/fonts/OFL-BagelFatOne.txt) and [`assets/fonts/LICENSE.txt`](assets/fonts/LICENSE.txt). Free for personal and commercial use; the font may be embedded in a website or app, but may not be sold on its own.

The named Pixel Paint font could not be found. Bagel Fat One replaced an earlier Ms Paint Mouse stand-in so the lettering is closer to the chunky rounded marker in Landry's logo.

The logo and card back are Landry's drawings, cleaned to 1-bit.

## Debug

- `?foil=1` — every pulled card is foil
- `?seed=123` — reproducible pack
- `?shot=title|map|shop|opening|new|foil|binder` — jump to a staged screen
- Reset collection buttons in the shop and binder
