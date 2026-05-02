# Questline — Cinematic Intro Brief

## Setting

A dim, candlelit chamber deep within an ancient library — the Archivist of Fate's sanctum. A hooded figure (the Archivist) is implied but never seen; the chronicler approaches an open Tome on a heavy oak desk. Mood is hushed, magical, slightly ominous. Think the Restricted Section of the Hogwarts library at midnight, or the inside of the Mages Guild in Skyrim.

The viewer is positioned as if they have just stepped up to the desk. The Tome lies open at the bottom of the frame; bookshelves and impossible architecture recede into darkness behind it.

## Style references

- **Skyrim / Elder Scrolls** parchment-and-iron palette: warm vellum, dim amber, deep umbers, near-black shadows
- **Harry Potter (films)** library / Restricted Section atmosphere — moving books, hanging dust, candles in iron sconces
- **Painterly digital illustration**, not photo-real. Visible brushstrokes welcome.
- Color saturation **low** overall, with selective amber/gold highlights from the candle. Deep, warm darks. No cool blues or greens.

The look should match the app's existing palette: backgrounds in `stone-950` (#0c0a09), amber accents around `amber-500` (#f59e0b), warm vellum tones around #f5e7c1 for highlights.

## The five parallax layers

Each layer must be a separate **PNG with transparent background** (except Layer 1, which is the full-bleed back). The Tome reads order back → front: Layer 1 is farthest, Layer 5 is closest.

### Layer 1 — Back wall / atmosphere (full bleed, opaque)

- Distant bookshelves dissolving into darkness, suggested rather than detailed.
- A vast vaulted ceiling lost in shadow.
- Faint motes of dust floating in negligible light.
- This is the dark canvas everything else sits on. **No transparency on this one — solid full-bleed background.**

### Layer 2 — Middle-back: rows of shelves

- Two or three rows of close-packed leather-bound books, half-silhouetted.
- A few crooked spines, a few tomes with faintly glowing gilt titles (illegible).
- Subtle warm amber rim-light from off-screen-right.

### Layer 3 — Middle: the desk and tome

- Heavy oak desk in lower third of frame, edge worn smooth.
- An open ancient tome at center — left page blank, right page covered in cursive script trailing off into emptiness.
- An iron inkpot, an inkwell with a few scattered drops of black ink, a folded letter.
- The Tome is the visual anchor; it is illuminated by the candle in Layer 4.

### Layer 4 — Middle-front: candle, quill, atmosphere

- A single tall candle in a brass holder, flame slightly bent. **The flame should be a separate PNG so we can animate the flicker.** (Alternatively: bake the flame into Layer 4 and we'll animate the whole layer's brightness.)
- A long grey quill resting beside the inkpot, half on the desk, half over the tome's right page.
- A hand-drawn warm glow / volumetric light radiating from the candle into the rest of the scene.
- Optional: a few floating dust motes (these will likely become Rive animations, but a few baked in are fine).

### Layer 5 — Foreground vignette

- Soft dark vignette around the edges (top, left, right). Bottom may stay open.
- Optional: blurred near-foreground edge of the desk or a corner of an open book closer to the camera, slightly out of focus, to anchor depth.
- Should NOT obscure the center where text overlays appear.

## Composition constraints (load-bearing)

- **Center 60% of the frame must be visually quiet** — text overlays type on across this area. Keep busy detail to the edges.
- **Lower 15% of the frame must accommodate buttons** ("Skip" right-aligned, "Begin your chronicle" centered). Keep this area dark and uncluttered.
- **The Tome is the only element that should sit in the lower-third center** — the buttons sit _over_ the bottom edge of the frame.
- **Aspect ratio: 9:19.5** (modern tall phones — 1170 × 2532 reference).
- **Resolution: deliver at 2x — 2340 × 5064**. We'll scale down. Larger is fine; we'll resize.

## File deliverables

Five PNGs, named exactly:

```
layer-1-back.png        ← solid background, no alpha
layer-2-shelves.png     ← alpha
layer-3-desk.png        ← alpha
layer-4-candle.png      ← alpha
layer-5-vignette.png    ← alpha
```

Optional separate flame element (for animation):

```
layer-4-flame.png       ← alpha, just the flame on transparent
```

## Where they go

Drop the files into:

```
C:\Users\shagg\Questline\assets\cinematic\
```

(I'll create that directory in advance — see next commit.)

Then commit + push the additions, and tell me when they're up. I'll wire them into [app/(onboarding)/cinematic.tsx](<../app/(onboarding)/cinematic.tsx>) — replacing the current placeholder layers (the candle-glow circle and the four faint horizontal lines) with proper `Image` components stacked in z-order, with the existing flicker animation re-pointed at `layer-4-flame.png`.

## Out of scope for this brief

- Rive animations (dust motes, quill entrance) — those are a separate brief / separate file format. Drop `.riv` files in `assets/cinematic/rive/` when ready and I'll wire them up.
- Voiceover audio — that's the ElevenLabs deliverable, separate.
- App icon / wordmark / launch screen — separate brief.
