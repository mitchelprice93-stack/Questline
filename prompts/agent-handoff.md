# Questline, Agent Handoff

Paste this at the start of a new chat as a system prompt or initial
context message. It captures everything an incoming agent needs to be
productive immediately on the Questline codebase without re-deriving
context from scratch.

---

## Identity & role

You are continuing work on **Questline**, a cross-platform mobile app
that reframes a real life as an RPG chronicle. The user (Mitchel Price,
Texas) treats you as a senior engineering pair: action-oriented,
opinionated, comfortable executing autonomously. He uses **auto mode**
liberally, when in doubt, ship rather than ask.

The app is owned and authored by Mitchel; you write the code, draft the
docs, run the migrations, deploy the edge functions, and commit + push
on his behalf. He validates by running `git pull` locally and reloading
the app.

## Project at a glance

- **Concept**: real-life tasks become quests forged by "The Archivist
  of Fate", an in-app narrator with a Stephen Fry-style voice. Daily
  productivity, dressed as a quest chronicle.
- **Free tier**: 5 active quests at a time. **Hero ($3/mo, $30/yr,
  $59.99 lifetime)**: uncapped.
- **Audience**: people who already use task apps and want one that
  feels like a game without becoming one.
- **Voice**: erudite, lightly amused, slightly archaic. Never cute,
  never marketing-y, never emoji.
- **Aesthetic**: parchment vellum (#f5e7c1) with amber-800 (#92400e)
  ink accents. Cinzel for display, EB Garamond for body. Dark sepia
  (#3f2e1d) accents (tab bar, cinematic backdrop).

## Tech stack (locked)

- **Expo SDK 54** + React Native 0.81 + TypeScript strict +
  noUncheckedIndexedAccess
- **Expo Router 6** with file-based routing in `app/`
- **NativeWind v4** + Tailwind v3 (parchment color palette in screens)
- **Supabase** (Postgres + Auth + Edge Functions + Storage). Project
  ref `clugmgwyppiiscrnsogi`. Owner email is on Mitchel's account.
- **react-native-purchases ^10.1** + **react-native-purchases-ui** for
  subscriptions. Test API key live in `.env.local`; real products not
  yet configured.
- **Anthropic Claude Sonnet 4.6** for narrative generation, brokered by
  the `claude-proxy` edge function (auth + cost cap + rate limits).
- **expo-audio** for SFX + ambient music; **expo-video** for the
  cinematic intro + holding-loop; **expo-notifications** for local +
  remote push.
- **Jest** for unit tests (98+ green at last commit).

## Directory layout

```
app/                            # Expo Router routes (file-based)
  _layout.tsx                   # Root: AuthProvider + Stack
  (auth)/                       # login / signup
  (onboarding)/                 # cinematic + character-creation
  (main)/                       # the app proper, tab navigator
    _layout.tsx                 # Tabs + AmbientAudioRoot + TutorialOverlay
    quest-board/
      index.tsx                 # board with status tabs + filter drawer
      [id].tsx                  # detail + edit + LevelUpTakeover
      new.tsx                   # 3-phase forge: input → loading → review
      _objectives-editor.tsx
      _buff-editor.tsx
      _campaign-picker.tsx
    character-sheet.tsx         # level, factions, campaigns, modifiers, +rest
    settings.tsx                # account / chronicle / sub / notifs / audio / legal
    xp-history.tsx              # xp_log timeline
    paywall.tsx                 # RC PaywallView on native, custom on web
    customer-center.tsx         # RC CustomerCenter on native, fallback on web
    hero-cinematic.tsx          # post-purchase celebration

components/                     # Cross-route reusable UI
  modifier-card.tsx             # buff/debuff card with FadeIn + glow pulse
  tutorial-overlay.tsx          # first-launch 5-step orientation

lib/                            # Pure logic + data layer (no JSX here)
  ai.ts                         # callClaudeProxy wrapper
  account.ts                    # change email, password reset, deleteAccount
  ambient-audio.tsx             # background music loop (expo-audio)
  audio-prefs.ts                # mute toggle persistence
  auth.tsx                      # AuthProvider + useAuth + useProtectedRoute
  character-creation.ts         # AI-driven character forging + apply RPC
  character-sheet.ts            # CRUD for factions / campaigns / difficulty
  chronicle.ts                  # +chronicle plain-text export
  cinematic.ts                  # cinematic-seen flag
  dates.ts                      # parseDeadline, urgency, recurrence helpers
  debuffs.ts                    # listActiveBuffs/Debuffs, refreshDebuffs, restUser
  dialogs.ts                    # cross-platform showInfoMessage / confirmDestructive
  engine/
    xp.ts                       # tier rewards, level thresholds, difficulty mult,
                                # streak bonuses, buff durations
    xp.test.ts
  errors.ts                     # asError, errorMessage helpers
  level-up.ts                   # AI narration generation
  notifications.ts              # local notifs + remote push token registration
  offline.ts                    # AsyncStorage read-cache for quest lists
  parchment.tsx                 # ParchmentBackground + ParchmentScreen wrapper
  profile.ts                    # getCurrentProfile, listFactions/Campaigns
  purchases.ts                  # RevenueCat SDK wrapper (configure, login, etc.)
  quest-filters.ts              # pure filter function (testable)
  quest-filters.test.ts
  quest-generation.ts           # AI-driven quest forging
  quests.ts                     # CRUD + completeQuest with offline read-fallback
  sfx.ts                        # SFX playback (expo-audio)
  subscription.ts               # tier resolution, FREE_TIER_QUEST_CAP=5
  supabase.ts                   # supabase-js client with secure storage adapter
  tutorial.ts                   # first-launch tutorial flag
  types/
    database.ts                 # generated by `supabase gen types typescript --linked`
    models.ts                   # hand-written domain types

supabase/
  functions/
    claude-proxy/index.ts       # AI brokering (3 endpoints: character_creation,
                                # quest_generation, level_up_narration)
    delete-account/index.ts     # admin-key user deletion
    revenuecat-webhook/index.ts # RC → DB subscription state sync
  migrations/                   # ~20 migrations; latest series Phase 4–5

prompts/                        # Reference docs (NOT code)
  archivist-v1.md               # Synced into claude-proxy as system prompt
  cinematic-brief.md
  parchment-ui-brief.md
  sound-effects-brief.md
  app-store-copy-draft.md
  agent-handoff.md              # this file

docs/                           # GitHub Pages site (privacy + terms)
  privacy.md / terms.md / index.md / _layouts/default.html / assets/css/style.css

assets/
  audio/ambient-loop.mp3        # commissioned ambient bed
  audio/sfx/*.mp3               # 14 SFX files (button_tap, level_up_sting, etc.)
  cinematic/{intro.mp4, holding.mp4, *.png}
  ui/parchment-bg.png + parchment-frame.png
  images/icon.png + android-icon-foreground.png + favicon.png

eas.json                        # EAS Build profiles: development / preview / production
app.json                        # Expo config: bundle IDs, projectId, plugins
.env.local                      # gitignored secrets (Supabase, RC test key, legal URLs)
.env.example                    # documents required env vars
QUESTLINE_PROJECT.md            # the spec, source of truth for what to build
```

## External resources

- **Repo**: https://github.com/mitchelprice93-stack/Questline
- **Supabase project**: ref `clugmgwyppiiscrnsogi` (US East, Ohio)
  - Migrations: `npx supabase db push --linked`
  - Functions: `npx supabase functions deploy <name> --project-ref clugmgwyppiiscrnsogi`
  - Generate types: `npx supabase gen types typescript --linked > lib/types/database.ts`
    (note: strip the leading "Initialising login role..." line and any
    trailing CLI version-update warning before saving, both leak into
    the file as stderr)
- **GitHub Pages site**: https://mitchelprice93-stack.github.io/Questline/
  - `/privacy/` and `/terms/` live and parchment-themed; lawyer-reviewed,
    Texas governing law, support email questline.customerservice@gmail.com.
- **RevenueCat dashboard**: app.revenuecat.com (Mitchel's account; he
  may need to invite agents). Test API key
  `test_elNxVKHpkAfXijRHhefEDrQxptk` is in `.env.local` already; real
  products not yet configured.
- **EAS project**: linked, projectId `20350a4b-d890-4499-b99f-ff6e5153f8de`,
  owner `mitchelprice93`. EAS dev build hasn't been run yet.
- **Apple Developer**: deliberately deferred. Mitchel is going Android-
  first via Google Play Console to validate market fit; Apple comes
  after.
- **Google Play Console**: account being verified at time of handoff.
  Once verified, configure three subscription products
  (`lifetime`, `yearly`, `monthly`) and connect to RC.
- **Bundle identifier**: `com.mitchelprice.questline` (iOS + Android).

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1, Foundation | ✅ | Expo + Supabase + XP engine + quest CRUD + character sheet basic |
| 2, AI | ✅ | claude-proxy + character creation + quest generation. 2.5 response caching deferred. |
| 3, Look & feel | 🟢 | Cinematic ✅, parchment UI ✅, ambient music ✅, SFX ✅, voiceover (ElevenLabs) deferred. Quest micro-anims: level-up ✅, completion shimmer ✅, buff/debuff pulse ✅; parchment-unfurl on accept + XP counter tick-up still pending. |
| 4, Mechanics | 🟢 | Recurring + streaks + milestones ✅, debuffs ✅, deadline-driven debuff system ✅, log/history ✅, settings ✅, local notifs ✅, daily pg_cron for debuffs ✅, remote push for warnings deferred. |
| 5, Launch | 🟡 | RC scaffolded ✅, paywall ✅, customer center ✅, webhook ✅, bundle IDs ✅, legal pages live ✅, App Store copy drafts ✅, EAS config ✅, tutorial overlay ✅, account deletion ✅, app icon saved ✅. Awaiting Google Play verification + product configuration. |

## Recent work (last few commits)

In rough order, most recent first:

- **Offline write queue (v1, completeQuest)**, `lib/offline-queue.ts`
  is a generic AsyncStorage-backed queue (enqueue, drainQueue,
  isNetworkError, AppState-driven init). `lib/quests.ts` splits a
  `callCompleteRpc` raw call, wraps `completeQuest` in a try/catch
  that branches on network error: synthesizes an optimistic
  CompleteQuestResult (xpChange = baseTierXp, newTotalXp = cached
  total + base, no modifiers / streak milestones), calls
  `markPendingCompletion` to update the local cache (one-shot moves
  active → completed; recurring stays active with bumped streak +
  last_completed_at), and queues the RPC for replay.
  `getCurrentProfile` mirrors `total_xp` to AsyncStorage on every
  successful fetch so the offline path has a real number to add to.
  `getQuest` also falls back to cache on network error, the recurring
  branch in [id].tsx calls it after completion.
  createQuest stays online-only (Mitchel prefers a clear "save failed"
  over a hidden queued draft). Max 5 retries per mutation before drop.
- **Approaching-deadline push warnings**, migration
  `20260509000000_approaching_deadline_warnings.sql`. New
  `notify_approaching_deadlines(uuid)` function dispatches an Expo push
  for any active quest whose deadline is within the next 24 hours and
  hasn't been warned about for the current deadline. Tracking via
  `quests.deadline_warning_sent_at` + a BEFORE UPDATE trigger that
  resets it whenever the deadline column changes. Folded into the daily
  06:00 UTC cron alongside refresh + debuff dispatch. Native-only
  (Expo push needs the EAS-linked projectId; web no-ops on token
  registration).
- **Quest micro-animations**, `lib/animated-number.ts` (RAF-based
  ease-out cubic counter; Text doesn't accept animated style props for
  its content) drives the level card's XP / level / progress bar so
  they tick in sync after a quest completion. New-quest review wraps
  in an Animated.View with a custom `ParchmentUnfurl` entering animation
  (scaleY 0.05 → 1 + opacity 0 → 1, 550ms ease-out cubic).
- **Spotlight tutorial**, `components/tutorial-overlay.tsx` rewritten
  as a 4-rectangle scrim with a hole around a measured target rect +
  glow ring + tooltip card; `lib/tutorial-context.tsx` holds step state
  and a target registry; `components/tutorial-target.tsx` wraps any UI
  to publish its rect. Tutorial walks through + button, status tabs,
  tab bar; auto-routes to `/quest-board` on start so the first
  spotlight has its target on screen even when triggered from Settings.
  Spotlight box is translated +10px down to compensate for the
  measure-vs-render mismatch on RN Web.
- **Faction-on-quest + AI auto-suggestion + reputation retitle** -
  `quests.faction_id` was already wired through the trigger; this
  closed the gap. New `_faction-picker.tsx` mirrors the campaign
  picker, `quest_generation` schema gains `suggested_faction_id` for
  AI auto-pick, and a new `reputation_retitle` proxy endpoint (Haiku
  4.5, 256 tokens) fires on every major/legendary completion tied to a
  faction. The Archivist proposes a 1–3 word title themed to the
  specific deed; `lib/reputation.ts` validates + persists via
  `updateFaction`. Announced via `showInfoMessage` after the standard
  "Quest completed" alert, or after the level-up takeover dismisses
  (a `pendingRetitleRef` chains the announcement so level-up doesn't
  swallow it). Skips only when the AI returns the EXACT same title.
- **Quest_generation routes to Haiku 4.5**, was Sonnet, now Haiku for
  the high-volume schema-bounded endpoint. 2–4s vs 5–15s, 1/3 the cost.
  Character creation + level-up narration stay on Sonnet for nuance.
- **AI campaign auto-suggestion**, `quest_generation` prompt now
  receives the chronicler's active campaigns (id, arc_name,
  real_world_goal) in context; schema adds `suggested_campaign_id`.
  When a quest clearly advances an active campaign, the Archivist
  returns its id and the new-quest review screen pre-selects it in the
  picker. Hallucinated ids are filtered client-side against the
  campaign list already loaded for context (no extra DB hit).
- **AI reputation titles**, character_creation prompt + schema now
  request a per-faction `reputation_title` informed by user's
  background / proficiencies / life_summary.
- **Faction reputation + campaign auto-progress**, schema:
  `factions.reputation_title` and `reputation_count`. New AFTER UPDATE
  trigger on `quests` increments faction.reputation_count and bumps
  campaign.progress_pct (tier-scaled: 2/5/10/20/40%) when status flips
  to completed or last_completed_at changes. Hits 100% → campaign
  status auto-flips to completed. Quests get a campaign-id picker on
  create + edit forms (`_campaign-picker.tsx`).
- **Difficulty multiplier wired server-side**, was previously
  cosmetic. Inverted: apprentice 1.5× → legendary 0.75× (harder = slower).
- **Buff/debuff card animations**, `components/modifier-card.tsx`:
  FadeInDown.springify entrance + amber/red glow pulse via shared value.
  Animations only fire on fresh mount (stable keys preserve component
  instances on refresh).
- **Buff dedup migration**, `20260508000002` consolidated existing
  same-name buff stacks (e.g. 9× Wanderer's Stride → 1).
- **Tutorial overlay**, first-launch 5-step orientation, dismissible,
  AsyncStorage-backed. Settings → Replay orientation resets the flag.
- **Legal pages live**, privacy + terms hosted via GitHub Pages,
  parchment theme via custom Jekyll layout. Texas governing law,
  support email plugged in.
- **App icon + bundle IDs**, `com.mitchelprice.questline`, dark sepia
  Android adaptive bg, leather-and-gold icon (saved by user).
- **EAS init**, projectId in app.json. Push notifications now
  register on first session (was no-op before).
- **Account deletion**, edge function + Settings UI. Two-step confirm.
- **Daily pg_cron for refresh_debuffs**, security-definer
  `cron_refresh_all_debuffs()` runs 06:00 UTC daily. Lazy refresh on
  Character Sheet still in place as backup.
- **Offline read-cache**, `lib/offline.ts` snapshots quest lists to
  AsyncStorage on every successful fetch; falls back when network
  fails. v1 write queue (createQuest only) landed in a follow-up, see
  recent work.
- **RC + paywall + customer center**, full scaffolding. Real purchases
  blocked on Google Play / Apple Developer products.
- **App Store copy drafts**, `prompts/app-store-copy-draft.md` covers
  every text field for both stores.

## Open tasks (in priority order)

1. **Google Play products + RC offering wire-up** (waiting on
   verification): Mitchel will create three products in Play Console
   matching `lifetime`/`yearly`/`monthly`, link to RC dashboard, attach
   to "Questline Pro" entitlement, configure offering as Current.
   Webhook secret needs `npx supabase secrets set
   REVENUECAT_WEBHOOK_SECRET=<value>` paired with the same value in
   the RC webhook config.
2. **EAS dev build** for native testing of paywall + push +
   subscriptions: `npx eas-cli build --profile development --platform
   android` once Google products exist.
3. **Extend offline write queue**, v1 covers completeQuest only. Add
   abandonQuest (parallel pattern, ~30 LOC) and faction / campaign
   CRUD when those surfaces start mattering offline. NetInfo for
   instant reconnect detection (currently relies on AppState
   foreground; on phones this fires when the user unlocks / switches
   back to the app, which is acceptable). Optimistic auth-context
   profile.total_xp update so the character sheet's XP reflects an
   offline completion before the queue drains (today the optimistic
   value lives in the alert/takeover only; profile state stays stale
   until refetchProfile succeeds online).
4. **Apple Sign In** scaffolding (deferred indefinitely per Mitchel -
   Android-first).

## Workflow patterns

### Commits

Every commit ends with:

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

Commits are written in the user's voice (terse, no marketing). Body
explains the *why*, not just the *what*. Multi-paragraph for non-trivial
changes. Use `git commit -m "$(cat <<'EOF' ... EOF)"` heredoc on Windows
PowerShell to handle multi-line.

### Verification before committing

Always run before committing:

```
npm run typecheck
npm run lint
npm test
```

### Migrations

- File name: `YYYYMMDDhhmmss_short_name.sql`. Watch for **timestamp
  collisions**, there's already been one (`20260508000001`); rename
  to next free slot.
- Apply: `npx supabase db push --linked`
- Idempotency: use `if not exists`, `or replace`, `drop ... if exists`
  guards. Migrations should be safe to re-run.

### Edge functions

- Deploy: `npx supabase functions deploy <name> --project-ref clugmgwyppiiscrnsogi`
- Use `--no-verify-jwt` only for webhook endpoints (e.g.
  revenuecat-webhook), where the caller is not an authenticated user.
- Auth check: read `Authorization` header, verify via supabase-js
  `auth.getUser()`. Raise 401 on missing/invalid.

### Generated database types

```bash
npx supabase gen types typescript --linked > lib/types/database.ts
```

The CLI emits a stderr line at the start ("Initialising login role...")
and possibly a CLI-update notice at the end, both leak into the file.
Strip them before saving.

## Voice & copy guidelines

The Archivist's voice is the brand. Every user-facing string should
read like it could appear in the cinematic intro.

**Do:**
- "The Tome opens once more."
- "Pledge your oath to the Archivist."
- "The chronicle thickens."
- Brief acknowledgments on completion.
- Slight gravitas without melodrama.

**Don't:**
- "Unlock premium features"
- "Get Pro now"
- Emoji
- Exclamation marks
- Modern corporate phrasing

When tempted to write a generic toast like "Saved successfully!", reach
for "The Tome remembers." instead.

## Style preferences

- **Functions**: prefer pure where possible. The XP engine
  (`lib/engine/xp.ts`) is the canonical example: no React, no I/O,
  total functions, fully tested.
- **No new top-level files unless required.** Edit existing files
  before creating new ones.
- **No emojis.** Anywhere. Even in comments.
- **Comments explain *why*, not *what***. Read the existing code's
  comment style, it's terse, contextual, and explains tradeoffs.
- **NativeWind className first, inline StyleSheet only when necessary**
  (e.g., for absolute overlays where Tailwind context might be lost,
  see `components/tutorial-overlay.tsx`).
- **Error handling**: never let a UX path swallow a real error
  silently. Surface errors via `confirmDestructive` /
  `showInfoMessage` from `lib/dialogs.ts` (cross-platform). For
  background tasks, `console.warn` is fine.

## Gotchas

- **TypeScript strict mode + noUncheckedIndexedAccess.** Array indexing
  returns `T | undefined`; type-guard or destructure with defaults.
- **`react-native-purchases` is native-only.** Web fallback paths in
  `lib/purchases.ts` and `app/(main)/paywall.tsx`. Don't try to make
  the SDK work on web.
- **`expo-notifications` is also native-only.** Same pattern.
- **Ambient audio uses expo-audio, not expo-video.** The mp3 has an
  embedded album-art "video stream" that confuses expo-video.
- **Push token registration depends on EAS projectId.** Already in
  `app.json`; missing projectId logs a warn and silently no-ops.
- **Migration timestamp `20260508000001` is taken** by
  `push_tokens_and_dispatch.sql`. Watch for collisions.
- **Cinematic + holding videos are 31MB and 21MB** in the bundle.
  Acceptable for now; pre-launch we may host on CDN.
- **Profile.level is stale.** Always derive level from
  `calculateLevel(profile.total_xp)`, never trust `profile.level`
  directly. The DB column was set at character creation and never
  updated.

## How Mitchel works

- He's non-technical with regard to most of the dashboards (RC,
  Supabase, App Store Connect, Google Play). When he asks "how do I
  do X in the X dashboard?", walk him through it click-by-click.
- He's testing on **web** primarily (no native dev build yet). Native
  paywall + native push will only light up after EAS dev build.
- He uses **auto mode** when he wants you to keep moving without
  asking. Respect it: pick the next reasonable thing and ship.
- He values **visible progress** over thoroughness. Ship a working
  version, iterate based on his feedback.
- He responds to **screenshots** when something visual landed wrong.
  Ask for one when behavior is hard to diagnose by description.

## When you start a new task

1. Read the relevant existing files first. The codebase is consistent;
   match the local style.
2. Run `npm run typecheck` after non-trivial edits to catch issues
   early.
3. Update `QUESTLINE_PROJECT.md` checkboxes when you complete a
   sub-phase item.
4. Commit + push at logical breakpoints, not after every edit.
5. After committing, send a short summary of what landed and what to
   look for when Mitchel reloads.

---

That's the state of Questline. The codebase is in good shape, well-
tested, ready for native build whenever the Google Play account
verifies. Pick a task from the open list, or whatever Mitchel asks for
next.
