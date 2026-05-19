# Questline, Sound Effects Brief

## Why this brief exists

Skyrim's UI is mostly silent until something *matters*, and when it does,
you get a horn flourish or a bell chime that lands like a small ceremony.
We want the same restraint here. Most taps are quiet. The big moments
(level up, quest complete, streak milestone) get a beat of weight.

This brief covers the full SFX library. Generate them in tiers, the
must-haves first, nice-to-haves later. The wiring code is built so
dropping any single file at the listed path makes that one sound work
immediately, with the others staying silent until they arrive.

## Where to generate

**Recommended: ElevenLabs Sound Effects** (https://elevenlabs.io/sound-effects).
Best-in-class for short, intentional sounds. Pay-per-generation but
cheap; you can iterate on a prompt until the take feels right.

Alternatives:
- **Pixabay** / **Freesound.org**, free, but you'll hunt through stock
  options for ones in the right voice
- **Suno** / **Udio**, overkill for SFX (they're music tools); use only
  for the level-up flourish if you want a melodic sting

## Style cohesion

Every SFX in this library should feel like it belongs in the same
soundscape:

- **Acoustic, organic**, leather, parchment, brass, glass, wood. Avoid
  synthetic blips, lasers, electronic UI sounds.
- **Warm and slightly dampened**, like the sound is happening in the
  Archivist's library, not in an empty room. A touch of natural reverb
  is fine; reverb tails should be short (under 0.4s).
- **Mid-range frequency**, no sharp highs, no rumbling lows. The user
  is hearing this from a phone speaker most of the time.
- **Volume budget**, every SFX gets normalized to **-16 LUFS** before
  shipping, so nothing startles when stacked against the -23 LUFS
  ambient bed. (See "Mastering" section at the bottom.)

---

## Tier 1, Must-haves (UI feedback)

### 1.1 · `button_tap.mp3`

Generic tap on a Pressable button. Plays on Mark Complete, Edit, Cancel,
+ New, etc.

> A soft single click, like a leather-bound book closing gently. Wood
> and leather, slightly dampened, with a very short tail. Crisp but not
> sharp. Medieval fantasy library UI sound. About 0.15 seconds long.

Duration: 0.1-0.2s. Drop at `assets/audio/sfx/button_tap.mp3`.

### 1.2 · `objective_check.mp3`

Tapping a checkbox in the objectives list.

> A brief ink-quill scratch on parchment, immediately followed by a
> faint dot, as if checking off a box on a hand-written list. Rough
> texture, dry, organic. Very short. About 0.25 seconds.

Duration: 0.2-0.3s. Drop at `assets/audio/sfx/objective_check.mp3`.

### 1.3 · `error.mp3`

Form validation fails, RPC errors, "Quest cap reached," etc. Should
read as *firm* not *harsh*, the Archivist disapproving, not punishing.

> A low brass chord, single note, slightly muted, like a horn played
> softly with a hand in the bell. Brief downward inflection at the end.
> Fantasy game disapproval cue. About 0.4 seconds.

Duration: 0.3-0.5s. Drop at `assets/audio/sfx/error.mp3`.

---

## Tier 2, Moment sounds (big beats)

### 2.1 · `quest_complete.mp3`

Plays when a quest finishes. The smaller of the celebration sounds -
this fires multiple times a day for active users.

> A short, satisfied bell chime, a single small brass bell, struck
> once with felt, with a brief warm ring-out. Similar to a Skyrim
> quest-objective-complete cue. Warm, achievement-feeling, but
> understated. About 0.8 seconds total.

Duration: 0.7-1.0s. Drop at `assets/audio/sfx/quest_complete.mp3`.

### 2.2 · `level_up_sting.mp3`

The big one. Plays on the LevelUpTakeover, BEFORE the Archivist's
narration begins. Sets the stage.

> A short orchestral fantasy flourish, three to four notes on horns
> and strings, ascending, with a final sustained chord that fades
> into reverb. Skyrim-style level-up sting: dramatic but warm,
> ceremonial, about 2-3 seconds long. No vocals. Ends on a held
> chord that decays naturally rather than cutting hard.

Duration: 2.0-3.0s. Drop at `assets/audio/sfx/level_up_sting.mp3`.

If ElevenLabs SFX struggles with this length, generate it on Suno or
Udio with prompt: *"Short fantasy game level-up flourish, 3 second
orchestral sting, ascending horns and strings, final sustained chord,
no drums, no vocals, ceremonial, warm."*

### 2.3 · `streak_milestone.mp3`

Fires on hitting a 7/30/100-day streak, layered over (or just after)
the quest_complete bell. Should feel like a *second* recognition on
top of the first.

> A bright single bell chime, higher pitched than the quest-complete
> bell, with a slight glissando shimmer behind it, as if struck and
> then resonating into a wind chime briefly. Triumphant but small.
> About 1 second.

Duration: 0.8-1.2s. Drop at `assets/audio/sfx/streak_milestone.mp3`.

### 2.4 · `buff_earned.mp3`

Plays when a granted buff lands (condition met on completion).

> A soft warm magical shimmer, like a single chime struck and then
> fading into a held vocal pad, but no actual voice, just the
> wordless suggestion of one. Pleasant, encouraging. Short tail.
> About 1 second.

Duration: 0.8-1.2s. Drop at `assets/audio/sfx/buff_earned.mp3`.

### 2.5 · `debuff_applied.mp3`

Plays when a debuff appears (deadline missed, quest abandoned).

> A low ominous chord on a single bowed cello, dampened, with a
> brief unsettled resolve. Disapproving but not threatening. The
> Archivist marking a slip. About 1 second.

Duration: 0.8-1.2s. Drop at `assets/audio/sfx/debuff_applied.mp3`.

---

## Tier 3, Nice-to-haves (texture)

### 3.1 · `tab_switch.mp3`

Bottom-tab navigation between Quests / Character / Settings.

> A soft page turn, a single sheet of heavy parchment lifted and
> dropped. Brief paper rustle, no sharp edges. About 0.3 seconds.

Duration: 0.2-0.4s. Drop at `assets/audio/sfx/tab_switch.mp3`.

### 3.2 · `quest_create.mp3`

Plays when "Save quest" succeeds in the new-quest flow. Different
from button_tap, this is the *commitment* sound.

> An ink quill scratching out a flourish on parchment, a longer,
> more ceremonial scratch than the objective check. Implies the
> Tome inscribing a new entry. About 0.6 seconds.

Duration: 0.5-0.8s. Drop at `assets/audio/sfx/quest_create.mp3`.

### 3.3 · `toggle_on.mp3` / `toggle_off.mp3`

Settings toggles (audio mute, daily check-in time, etc.).

For `toggle_on`:

> A small wooden latch clicking into place. Two-part sound: the
> click of a small mechanism plus a faint warm chime. About 0.2 seconds.

For `toggle_off`:

> The same wooden latch unlatching, a soft thunk and brief release.
> No chime. About 0.2 seconds.

Duration: 0.15-0.25s each. Drop at `assets/audio/sfx/toggle_on.mp3`
and `assets/audio/sfx/toggle_off.mp3`.

### 3.4 · `quill_scratch.mp3`

Optional ambient flavor for moments the AI is "thinking", could
play during the loading state when the Archivist is forging a quest
or composing level-up narration.

> Continuous ink quill scratching on parchment, mid-pace, looping
> seamlessly. Dry, organic, no metal. About 1.5 seconds, designed
> to loop.

Duration: 1.0-2.0s, seamless loop. Drop at `assets/audio/sfx/quill_scratch.mp3`.

---

## Tier 4, Future (when those features ship)

### 4.1 · `hero_pledge.mp3`

For when a free user upgrades to Hero. Play during the upgrade
cinematic (deferred until RevenueCat is wired).

> A small heap of gold coins poured into a brass dish, bright
> metallic clinks, then a single warm horn note acknowledging the
> donation. Ceremonial, not garish. About 1.5 seconds.

Duration: 1.2-1.8s. Drop at `assets/audio/sfx/hero_pledge.mp3`.

---

## Mastering

Once each clip is generated, run a quick pass before committing:

1. **Trim silence** at head and tail (zero-crossing if possible).
2. **Normalize to -16 LUFS** integrated. ElevenLabs output is usually
   too quiet against the -23 LUFS ambient bed; bumping to -16 means
   SFX are clearly audible without being jarring.
3. **Export as MP3, 192 kbps stereo, 44.1 kHz**.

A free tool that handles all three: [Audacity](https://www.audacityteam.org)
with the LUFS Loudness Normalization filter. Five minutes per clip.

## File path summary

```
assets/audio/sfx/button_tap.mp3
assets/audio/sfx/objective_check.mp3
assets/audio/sfx/error.mp3
assets/audio/sfx/quest_complete.mp3
assets/audio/sfx/level_up_sting.mp3
assets/audio/sfx/streak_milestone.mp3
assets/audio/sfx/buff_earned.mp3
assets/audio/sfx/debuff_applied.mp3
assets/audio/sfx/tab_switch.mp3        (optional)
assets/audio/sfx/quest_create.mp3      (optional)
assets/audio/sfx/toggle_on.mp3         (optional)
assets/audio/sfx/toggle_off.mp3        (optional)
assets/audio/sfx/quill_scratch.mp3     (optional)
assets/audio/sfx/hero_pledge.mp3       (future)
```

## Wiring

Code-side: a `lib/sfx.ts` module exposes `playSfx('button_tap')` etc.,
backed by silent-placeholder mp3s for every entry above. As real
files replace the placeholders, the corresponding sound starts firing
at the corresponding moments, no code change. Triggers wired in
parallel to this brief; see the same-day commit.
