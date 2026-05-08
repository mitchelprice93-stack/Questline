// Phase 5.x — sound effects.
//
// Every SFX in `prompts/sound-effects-brief.md` gets one preloaded
// expo-audio player here. Trigger any of them with `playSfx('button_tap')`
// from anywhere in the app — the call is sync and idempotent (no-ops if
// the user has audio muted via the Settings toggle).
//
// Players are created lazily on first play() so the import has no startup
// cost on splash. Re-triggering a still-playing sound rewinds and replays
// (most SFX are short enough this is the right behavior).

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import { getAudioMuted } from './audio-prefs';

// Asset map. Each require() is bundled by Metro at build time; missing
// paths would surface as bundle-time errors, so dropping files in /assets
// is the only deploy.
const SOURCES = {
  button_tap: require('../assets/audio/sfx/button_tap.mp3'),
  objective_check: require('../assets/audio/sfx/objective_check.mp3'),
  error: require('../assets/audio/sfx/error.mp3'),
  quest_create: require('../assets/audio/sfx/quest_create.mp3'),
  quest_complete: require('../assets/audio/sfx/quest_complete.mp3'),
  level_up_sting: require('../assets/audio/sfx/level_up_sting.mp3'),
  streak_milestone: require('../assets/audio/sfx/streak_milestone.mp3'),
  buff_earned: require('../assets/audio/sfx/buff_earned.mp3'),
  debuff_applied: require('../assets/audio/sfx/debuff_applied.mp3'),
  tab_switch: require('../assets/audio/sfx/tab_switch.mp3'),
  toggle_on: require('../assets/audio/sfx/toggle_on.mp3'),
  toggle_off: require('../assets/audio/sfx/toggle_off.mp3'),
  quill_scratch: require('../assets/audio/sfx/quill_scratch.mp3'),
  hero_pledge: require('../assets/audio/sfx/hero_pledge.mp3'),
} as const;

export type SfxName = keyof typeof SOURCES;

// Per-SFX volume tweaks. Most sit at 1.0; some need to be ducked slightly.
// Tune these by ear once the assets are real (current values are sane
// defaults for normalized −16 LUFS clips).
const VOLUMES: Partial<Record<SfxName, number>> = {
  button_tap: 0.55, // fires constantly; keep it light
  objective_check: 0.6,
  tab_switch: 0.5,
  toggle_on: 0.6,
  toggle_off: 0.6,
  quill_scratch: 0.4, // ambient flavor, very quiet
  // Moment sounds default to 1.0 — they're meant to land.
};

const players: Partial<Record<SfxName, AudioPlayer>> = {};

function getPlayer(name: SfxName): AudioPlayer {
  let p = players[name];
  if (!p) {
    p = createAudioPlayer(SOURCES[name]);
    p.volume = VOLUMES[name] ?? 1.0;
    players[name] = p;
  }
  return p;
}

// Cached mute pref. Refreshed on every play() — the read is cheap
// (AsyncStorage) but synchronous-with-await; we cache the last value
// so a tap that happens after the user toggles mute respects it on
// the *next* tap, which is fine for SFX latency-wise.
let cachedMuted = false;
let mutedRefreshInFlight = false;

async function refreshMutedFlag() {
  if (mutedRefreshInFlight) return;
  mutedRefreshInFlight = true;
  try {
    cachedMuted = await getAudioMuted();
  } finally {
    mutedRefreshInFlight = false;
  }
}
// Kick off the initial read at module load.
void refreshMutedFlag();

/**
 * Play a sound effect. Fire-and-forget — never throws, never returns a
 * promise. Honors the audio-mute pref; if muted, the call is a no-op.
 *
 * Call this from anywhere — Pressable onPress handlers, RPC success
 * paths, useEffect on takeover mount, etc. It's safe to call on every
 * render; the underlying player is shared and re-seeked.
 */
export function playSfx(name: SfxName): void {
  // Refresh the mute flag in the background so toggle changes settle in.
  void refreshMutedFlag();
  if (cachedMuted) return;

  try {
    const p = getPlayer(name);
    // seekTo(0) lets a still-playing sound retrigger from the start —
    // useful for rapid button mashing.
    p.seekTo(0);
    p.play();
  } catch (e) {
    // SFX failures are never user-facing; log and move on.
    console.warn('[sfx] play failed', name, e);
  }
}

/**
 * Start playing an SFX in loop mode (e.g. quill_scratch under an AI loading
 * spinner). Honors mute the same way playSfx does. Pair every startLoop
 * with a stopLoop or the sound will play forever.
 */
export function startLoopSfx(name: SfxName): void {
  void refreshMutedFlag();
  if (cachedMuted) return;
  try {
    const p = getPlayer(name);
    p.loop = true;
    p.seekTo(0);
    p.play();
  } catch (e) {
    console.warn('[sfx] startLoop failed', name, e);
  }
}

/** Stop a looping SFX started by startLoopSfx. Idempotent. */
export function stopLoopSfx(name: SfxName): void {
  const p = players[name];
  if (!p) return;
  try {
    p.pause();
    p.loop = false;
  } catch (e) {
    console.warn('[sfx] stopLoop failed', name, e);
  }
}

/** Pause and release every player. Currently unused — call this if we
 *  ever need to free up the audio session (e.g. before recording). */
export function disposeSfx(): void {
  for (const name of Object.keys(players) as SfxName[]) {
    const p = players[name];
    if (!p) continue;
    try {
      p.pause();
    } catch {
      // ignore — best-effort cleanup
    }
    delete players[name];
  }
}
