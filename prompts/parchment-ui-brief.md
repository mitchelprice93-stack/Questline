# Questline — Parchment UI & Ambient Audio Brief

## Why this brief exists

The text, type, and layout of Questline are landing well. The next pass of
polish is to retire the flat dark background in favor of an actual parchment
surface, with subtle paper edge, fringe, and a quiet ambient music bed. Same
in-world feel as the cinematic, just every screen.

## What's needed

Three deliverables, deliverable separately:

1. **Parchment background texture** — used as the canvas of every screen.
2. **Parchment frame / fringe overlay** — a torn/burned edge that wraps the
   viewport at the screen's outermost border.
3. **Ambient music loop** — a few minutes of quiet RPG-library ambience.

## 1 · Parchment background texture

### Style references

- **Skyrim** spell-tome and journal pages — warm vellum, faint creases, ink
  ghosting from previous pages.
- **Harry Potter** Marauder's Map — visible folds, slight discoloration at
  the edges, ink bleed.
- Dungeon master's screen / D&D 5E player handbook page texture.

### Constraints

- **Color**: warm vellum, base around `#f5e7c1` to `#e6d2a8`, never pure
  white — the existing amber accents (`amber-500` / `amber-600`) need to
  read against it.
- **Saturation**: low. Subtle stains, faint creases, occasional ink ghost.
  The texture must NOT compete with content.
- **Center 80% of the frame must be visually quiet** — text and chrome
  render directly on it. Detail belongs at edges and corners.
- **Tile-able OR full-bleed**: prefer a single ~2400 × 5200 PNG sized for
  9:19.5 phones. If tile-able, mark the tile size in the filename.
- Format: **PNG**, 8-bit, opaque (no alpha — this is the canvas).
- Resolution: 2× retina — i.e. deliver at 2400 × 5200 minimum so we can
  scale down without softness.

### Out of scope

- Text rendered onto the texture (we draw type at runtime).
- Faction or campaign symbolism (those go in their own assets).

## 2 · Parchment frame / fringe overlay

### What it is

A separate PNG drawn on top of the parchment background, with the **center
99% transparent** and the outer edge a torn/burned/scorched parchment fringe
— so every screen looks like the user is reading a single ragged-edged sheet.

### Constraints

- **Aspect**: matches the parchment background (9:19.5).
- **Fringe band**: 60-120 px on a 2400-wide canvas. Heavier in corners,
  optionally lighter along long edges. Asymmetric is fine — it should feel
  hand-torn.
- **Alpha**: full transparency in the central area; fringe band fades from
  opaque to transparent so it blends with the parchment underneath.
- **No drop shadow** — we apply that at runtime if needed.
- Format: **PNG with alpha**, 2400 × 5200 minimum.

### Where it goes

`assets/ui/parchment-frame.png`. The app code will overlay it as a
`StyleSheet.absoluteFillObject` Image with `pointerEvents="none"` above all
content but below modals.

## 3 · Ambient music loop

### Vibe

- Restricted-section-of-the-Hogwarts-library quiet.
- Soft strings, distant solo cello, subtle wind, the suggestion of pages
  turning. Not melodic — atmospheric. Should not pull attention from the
  app.
- Pad-and-texture, no recognizable tune the user would hum.

### Constraints

- **Length**: 2–4 minutes, looped seamlessly. The seam must be inaudible
  with no fade-out / fade-in cliff.
- **Dynamic range**: compressed. The user will hear it under text reading
  and quest creation, often with their own audio playing nearby — quiet
  ducked baseline, no peaks.
- **LUFS target**: -23 to -20 integrated. (The cinematic mix was louder;
  this should sit a couple notches below it.)
- **Format**: mp3, 192 kbps, stereo. AAC also fine.
- **No vocals.** If a chorus pad has any human-voice timbre, keep it
  textural / wordless.

### Where it goes

`assets/audio/ambient-loop.mp3`. The app's audio layer will pick it up
automatically — the player is already wired and gracefully no-ops when the
file is missing, so dropping the file in is the deploy.

### Out of scope

- Voiceover / character lines (ElevenLabs, separate brief)
- Quest-specific stingers (level-up flourish, completion sting, etc.) —
  separate brief once the ambient bed is in place
- Cinematic intro / holding music (already shipped)

## File deliverables summary

```
assets/ui/parchment-bg.png        ← the canvas, opaque, ~2400 × 5200
assets/ui/parchment-frame.png     ← the fringe, alpha, ~2400 × 5200
assets/audio/ambient-loop.mp3     ← 2-4 min loop, -23..-20 LUFS, no vocals
```

Drop them at those paths and commit; the wiring code lives behind the file
existence checks so adding the assets is the entire deploy.

## Notes on the UI restyle

Once the parchment is in, the existing dark-stone color tokens
(`bg-stone-950`, `border-stone-800`, etc.) will be retired surface by
surface. Type colors will warm up — current `text-stone-100` becomes a
charcoal ink (`#1f1a17`-ish) for body, with the existing amber accents
unchanged. The actual restyle is a code task that happens after the
textures land; this brief is just the assets it depends on.

---

## Appendix A — Generator-ready prompts

Drop these straight into Midjourney, DALL-E, Stable Diffusion (the
recommended target is Midjourney v6 or DALL-E 3 — both handle the
warm-ink-on-vellum style well). For music, Suno v4 or Udio.

### A.1 · Parchment background — image prompt

> Aged vellum parchment background, full-page texture, warm ivory base
> color shifting toward soft amber at the corners, faint horizontal
> creases, subtle ink ghosting from previous pages, quill-scratch
> marks at the very edges, occasional small tea-colored stains, no
> writing or symbols, no torn edges (those go on a separate layer),
> hand-painted look, painterly watercolor texture, low saturation,
> high resolution scan quality. Style references: Skyrim spell-tome
> page, Dungeons & Dragons player handbook page, Marauder's Map
> middle section. **Aspect ratio 9:19.5, resolution 2400×5200,
> opaque (no transparency).** Center 80% must remain visually quiet
> — keep detail at edges and corners. **No text, no characters, no
> illustrations, no figures, no maps, no symbols.**

Negative prompt (Stable Diffusion only):

> text, letters, words, characters, drawings, figures, faces,
> symbols, runes, maps, diagrams, illustrations, modern paper, white
> printer paper, blue tint, green tint, glossy, plastic, photo
> reference of real paper sheet on a desk

Output format: PNG, 2400 × 5200 minimum, no alpha channel.

### A.2 · Parchment fringe overlay — image prompt

> Torn and burned parchment edge, ragged irregular border, scorched
> brown burn marks fading to charcoal black at the very edge,
> hand-torn fibers, some areas slightly more burnt than others,
> asymmetric, organic — as if a single sheet was ripped from a
> larger document and singed by a candle. The border band is heavy
> in the corners and lighter along the long edges. **The center of
> the frame is fully transparent — only the edge of the page is
> visible.** Style: hand-painted, watercolor and ink, painterly,
> Skyrim journal aesthetic. **Aspect ratio 9:19.5, resolution
> 2400×5200, transparent center (alpha PNG).** Edge band 60-120 px
> wide on the 2400-wide canvas. **No paper texture in the center —
> just the torn edge.**

Negative prompt (Stable Diffusion only):

> filled center, paper texture, full sheet, complete document, text,
> writing, ink, white background, solid color background, frame
> shape, picture frame, ornamental border, gold leaf, decoration

Output format: PNG with alpha, 2400 × 5200 minimum. Center 99%
transparent.

### A.3 · Ambient music loop — generator prompt

For Suno v4 or Udio. Paste this as the description / lyrics-free
instrumental prompt:

> Ambient library music, dark medieval fantasy, restricted-section-
> at-midnight atmosphere. Sustained legato strings, distant solo
> cello, soft choir pad with no discernible vocals, very subtle wind
> through wooden rafters, occasional faint page turn or quill
> scratch. No melody to speak of — atmospheric texture only.
> Tempo 50-60 BPM but rhythmless. Heavily compressed dynamic range,
> quiet baseline that never builds to a climax. No percussion. No
> drums. No discernible chord progression — just slow harmonic
> drift. Wordless. Two to three minutes long, designed to loop
> seamlessly.

Settings to choose where available:

- **Instrumental only**: ON
- **Length**: 2:30 minimum (Suno default 2:00 might be too short for
  comfortable looping)
- **Style**: ambient, drone, soundscape, dark fantasy
- **Mood**: contemplative, mysterious, library, calm

Post-generation processing (whoever masters):

- Normalize to **−23 to −20 LUFS integrated**
- Trim head and tail to a zero-crossing for clean loop seam
- Export as 192 kbps stereo MP3 at 44.1 kHz

Drop the final file at `assets/audio/ambient-loop.mp3` to replace the
current 5-second silent placeholder. The wiring is already in place
— no code change is needed once the file is there.

### A.4 · (Future, optional) Hero upgrade cinematic — image prompt

Not needed today. When we wire the Hero subscription cinematic, the
art prompt would be the same Archivist sanctum from `cinematic-brief.md`
but with **the Tome glowing brighter, gold leaf catching the candle
flame, a hand reaching across the frame from below to lay coins on
the desk** — a moment of formal acknowledgment. We'll commission
that separately.
