# QUESTLINE, V1 BUILD SPEC

> Drop this entire document into Claude Code as the project's foundational reference. Treat it as the source of truth for v1 scope, architecture, and build order. Do not deviate without explicit instruction.

---

## PROJECT OVERVIEW

**Questline** is a cross-platform mobile app that gamifies real-world task management using a Skyrim/Harry Potter-inspired RPG framework. Users create a character, define their factions (work, school, side projects), and convert real tasks into quests with XP, levels, buffs, and debuffs. An AI character, **The Archivist of Fate**, generates narrative flavor in the voice of a Stephen Fry-style British narrator.

**Core architectural principle: hybrid intelligence.**
- Deterministic code owns: XP math, level thresholds, quest state, scheduling, debuff triggers, payments, auth.
- AI (Claude API) owns: quest titles, descriptions, faction names, character sheet narration, Archivist dialogue.
- The AI must NEVER own state. It receives state, narrates over it, and returns text.

---

## TECH STACK (LOCKED)

```
FRONTEND
- React Native + Expo (managed workflow)
- TypeScript (strict mode)
- Expo Router (file-based navigation)
- NativeWind (Tailwind for RN)
- Rive (rive-react-native) for cinematic animations
- react-native-track-player for layered audio

BACKEND
- Supabase (Auth + Postgres + Edge Functions + Storage)
- Claude API via Edge Function proxy (NEVER call from device)
- Models: Sonnet for narrative generation, Haiku for cheap parsing/classification

INFRASTRUCTURE
- RevenueCat for cross-platform subscriptions
- Sentry for error tracking
- PostHog for product analytics
- EAS Build for iOS/Android builds

DEV TOOLS
- Claude Code as primary AI pair programmer
- GitHub (private repo)
- Linear or Notion for task tracking
```

**Hard rules:**
- All Claude API calls go through a Supabase Edge Function. The API key never touches the client.
- Per-user daily rate limits enforced server-side. Non-negotiable.
- Local-first where possible. Quests must remain viewable and completable offline; sync when online.

---

## NON-NEGOTIABLE PRINCIPLES

1. **Build the XP engine first, with tests, in pure TypeScript.** No UI, no DB, no AI until the math is bulletproof.
2. **Ship in private until Phase 3.** No screenshots, no YouTube content, no public posts before the cinematic works.
3. **The AI does not own state.** Ever. If you find yourself letting Claude track XP totals or quest IDs, stop and rearchitect.
4. **Cost ceiling per user per day must be enforced before launch.** A spammer should hit a wall, not bankrupt the project.
5. **Test on cheap Android.** Target a $200 Samsung. If it runs at 60fps there, it runs everywhere.
6. **Scope creep dies in the "Phase 2 Vault" doc** (see end of this file). Anything not in v1 goes there. No exceptions.

---

# PHASE 1, FOUNDATION

**Goal:** A working app that lets the user create quests, mark them complete, and earn XP. No AI, no animations, no audio. Just the loop.

**Duration estimate:** Weeks 1-3.

**Exit criteria:** I can open the app, create a quest manually, complete it, see my XP increase, and level up. All offline. All persisted.

## 1.1 Project Initialization
- [ ] Create Expo project with TypeScript template (`npx create-expo-app questline --template`)
- [ ] Configure strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- [ ] Install and configure NativeWind, Expo Router, ESLint, Prettier
- [ ] Set up `app/` directory structure with placeholder routes:
  - `app/(auth)/`, login, signup
  - `app/(onboarding)/`, cinematic, character creation
  - `app/(main)/`, quest board, character sheet, settings
- [ ] Initialize Git repo, push to private GitHub
- [ ] Create `.env.example`, document required env vars

## 1.2 Supabase Setup
- [ ] Create Supabase project (free tier)
- [ ] Define schema (see SCHEMA section below) and apply via migration files
- [ ] Configure Row Level Security (RLS) on every table, users only access their own rows
- [ ] Generate TypeScript types from schema (`supabase gen types typescript`)
- [ ] Install `@supabase/supabase-js`, configure client with secure storage adapter

## 1.3 Authentication
- [ ] Email/password sign-up + login
- [ ] Apple Sign In (REQUIRED by App Store if any social login is added)
- [ ] Google Sign In (Android-friendly)
- [ ] Session persistence with secure storage
- [ ] Auth-gated routing, unauthenticated users see only `(auth)` group

## 1.4 XP Engine (pure TypeScript, isolated module)
**This is the most important file in the codebase. Build it first. Test it relentlessly.**

Location: `lib/engine/xp.ts`

Required functions:
- [ ] `calculateLevel(totalXp: number): { level: number, currentLevelXp: number, nextLevelXp: number }`
- [ ] `xpForTier(tier: QuestTier): number`, Trivial 100, Minor 500, Standard 1500, Major 5000, Legendary 15000
- [ ] `applyDifficultyModifier(xp: number, difficulty: Difficulty): number`
- [ ] `applyBuffsAndDebuffs(xp: number, modifiers: Modifier[]): number`
- [ ] `assessStartingLevel(lifeSummary: string, campaignCount: number): number`, heuristic, capped at 12
- [ ] `levelThresholds: number[]`, precomputed up to L50

Level thresholds (cumulative XP, must match):
- L1→2: 1,000  ·  L2→3: 2,500  ·  L3→4: 5,000  ·  L4→5: 10,000
- After L5: each gap = previous gap × 1.5

Test file: `lib/engine/xp.test.ts`. Use Jest. Cover edge cases: zero XP, negative modifiers stacking below zero, level-up boundary conditions, max level cap.

## 1.5 Quest CRUD (no AI yet)
- [ ] Quest list screen (Quest Board), pulls active quests from Supabase
- [ ] "Create Quest" form, manual title, description, tier picker, optional deadline, faction picker
- [ ] Quest detail screen, view objectives, mark complete, abandon
- [ ] Complete action: writes to `xp_log`, updates user's `total_xp`, recalculates level
- [ ] Local cache via SQLite or MMKV for offline quest viewing/completion
- [ ] Sync queue for offline completions

## 1.6 Character Sheet (basic)
- [ ] Static character sheet screen showing: name, level, XP bar, factions, active quest count
- [ ] No styling polish yet, function over form in Phase 1

## Phase 1 Definition of Done
- App installs and runs on iOS simulator and Android emulator
- A user can sign up, create 5 quests, complete 3 of them, and see their level update
- All XP engine tests pass
- No crashes in 30 minutes of dogfooding
- No AI integration yet, that's Phase 2

---

# PHASE 2, AI INTEGRATION

**Goal:** The Archivist comes online. Quest creation now generates narrative. Character creation produces a personalized character sheet.

**Duration estimate:** Weeks 4-6.

**Exit criteria:** I can fill out the character creation form and receive a fully-narrated character sheet from the Archivist. I can create a quest in plain language and receive a properly-formatted, lore-anchored quest back.

## 2.1 Edge Function Proxy
- [ ] Supabase Edge Function `claude-proxy`, accepts user requests, forwards to Claude API, returns response
- [ ] Auth verification, only authenticated users can call
- [ ] Rate limiting per user (configurable, default: 50 quest generations/day, 1 character creation lifetime)
- [ ] Request/response logging to `ai_call_log` table for cost monitoring
- [ ] Hard daily cost ceiling per user (default: $0.50/day), return graceful error if exceeded
- [ ] Model routing: Sonnet for character creation + quest generation, Haiku for input parsing/classification

## 2.2 System Prompt Integration
- [ ] Store the Archivist system prompt as a versioned file in the repo (`prompts/archivist-v1.md`)
- [ ] Load and inject prompt into every Claude call
- [ ] Include compact character sheet in every quest-generation call so AI has context

## 2.3 Character Creation Flow
- [ ] 7-card swipeable form:
  1. Name + optional title
  2. Background lore
  3. Faction (employment)
  4. Proficiencies (education)
  5. Life summary (drives starting level)
  6. Current campaigns
  7. Inventory (optional, skippable)
- [ ] Submit collects all fields into structured payload
- [ ] Loading screen ("The Archivist studies your tome...") with 6-second hard timeout
- [ ] Fallback: if AI call fails, generate templated character sheet so user is never blocked
- [ ] Parse AI response into structured data: factions (with names + domains), starting level, class title, campaign arcs, first quest hook
- [ ] Persist all of the above to Supabase

## 2.4 AI Quest Generation
- [ ] User types a quest in plain language ("finish thermo lab report by Friday")
- [ ] Frontend sends to edge function with current character context
- [ ] Claude returns: quest title, description, objectives checklist, classification, suggested tier, tactical warnings (if any)
- [ ] User sees generated quest, can accept / edit / reject
- [ ] On accept: persist with AI-generated narrative, code-assigned XP

## 2.5 Response Caching
- [ ] Cache common quest patterns (e.g., "go to gym," "study for [class]") to reduce API spend
- [ ] Cache key includes user's faction list so cached responses still feel personalized
- [ ] TTL: 7 days

## Phase 2 Definition of Done
- New users complete character creation and receive a personalized, in-character output
- Quest generation works for 95% of inputs without errors
- API costs per active user are measured and documented
- Rate limiting tested with deliberate abuse attempts
- The Firewall rule (no proactive sensitive topic mentions) verified across 20 test inputs

---

# PHASE 3, THE MAGIC

**Goal:** Questline becomes screenshottable. The cinematic, audio, and animations transform the app from "functional" to "shareable."

**Duration estimate:** Weeks 7-10.

**Exit criteria:** A new user opens the app for the first time and gets goosebumps within 30 seconds. The character sheet reveal feels cinematic. The app has visual identity.

## 3.1 Visual Identity
- [ ] Final logo, app icon, wordmark integrated (commissioned externally)
- [ ] Color palette tokens in NativeWind config (warm parchment palette)
- [ ] Typography system: serif display font (Cinzel), readable body font (Inter or EB Garamond)
- [ ] Component library: buttons, cards, modals, form inputs, all themed
- [ ] Dark mode is default; light mode is optional toggle

## 3.2 Cinematic Intro
- [ ] Commission illustrator: 5-layer parallax library scene (dark fantasy parchment, candlelit)
- [ ] Implement parallax scrolling with depth on app launch
- [ ] Rive animations: dust motes, candle flicker, quill entrance
- [ ] Type-on text sequence with the 5 narration beats
- [ ] Skippable after 3 seconds; auto-skipped on second launch
- [ ] Plays before character creation only on first run

## 3.3 Audio System
- [ ] Integrate `react-native-track-player`
- [ ] Layered ambient beds: library (default), tavern (quest board), forge (completion)
- [ ] Respect device audio focus, duck under Spotify/podcasts, never fight
- [ ] Mute toggle in settings, persisted
- [ ] All audio files compressed to OPUS or AAC, total bundle size < 15MB

## 3.4 Voiceover (ElevenLabs)
- [ ] Generate Archivist voice clips for cinematic narration (5 lines)
- [ ] Generate generic Archivist phrases for system events (level up, quest complete, debuff applied, etc.)
- [ ] Pre-generate and bundle as audio files, no real-time TTS in v1
- [ ] Voice trigger logic: play on cinematic, level-up, character sheet reveal
- [ ] Always skippable, always mutable

## 3.5 Character Sheet Reveal Animation
- [ ] After character creation, sheet reveals with cinematic type-on
- [ ] Each section (factions, level, title, campaigns) appears in sequence
- [ ] Subtle particle/glow effects via Rive
- [ ] Final state: full character sheet with "Begin Your Chronicle" CTA

## 3.6 Quest Micro-Animations
- [ ] Quest accept: parchment-unfurl animation
- [x] Quest complete: gold-shimmer overlay (700ms double-layer fade) on Mark complete success when no level-up. XP counter tick-up still pending.
- [x] Level up: full-screen takeover with title card + AI narration
- [x] Buff applied: amber pulse on the modifier card mount (220ms peak → 480ms fade) + FadeInDown.springify entry
- [x] Debuff applied: red pulse on the modifier card mount, same shape

## Phase 3 Definition of Done
- Cinematic plays smoothly at 60fps on iPhone 12+ and a $200 Android (Samsung A-series test device)
- Audio mixes cleanly without fighting other apps
- Five separate beta testers describe the cinematic as "magical" or equivalent
- Bundle size remains under 80MB
- Frame drops < 5% during animations

---

# PHASE 4, MECHANICS

**Goal:** The full RPG system is operational. Recurring quests, debuffs, notifications, and the daily/weekly rhythm.

**Duration estimate:** Weeks 11-13.

**Exit criteria:** A user can rely on Questline as their actual task manager for a full week without missing anything important.

## 4.1 Recurring Quests
- [x] Daily quest type, auto-resets each day
- [x] Weekly quest type, auto-resets each week
- [x] Streak tracking on recurring quests
- [x] Streak rewards: bonus XP at 7-day, 30-day, 100-day milestones

## 4.2 Debuff Engine
- [~] Background job runs daily, deferred to pg_cron once SDK 4.4 lazy-refresh proves out; today refresh_debuffs_for is invoked on character-sheet load
- [x] Detects neglected quests:
  - 3 days untouched → "Cobwebs of Procrastination" (-10% XP next completion)
  - 7 days untouched → "Curse of the Idle Blade" (XP halved)
  - Abandoned quest → "Mark of the Forsaken" (-5% next quest, 1-quest duration)
- [x] Debuffs visible on character sheet
- [x] `+rest` button clears debuffs older than 14 days, once per week
- [x] Difficulty scaling: Master/Legendary stack debuffs (sum of pcts); Apprentice/Adept apply only the worst

## 4.3 Push Notifications
- [ ] Expo Push notifications setup, token registration deferred until first remote-push use case (debuff warnings)
- [x] Local notifications for quest deadlines (24h, 1h before), scheduled on quest create/edit, cancelled on complete/abandon
- [ ] Remote notifications for debuff warnings, deferred to a follow-up that adds an edge function + push tokens
- [x] Daily check-in nudge (configurable time, default off; 7/8/9 AM and 8 PM presets)
- [x] All notifications use Archivist voice in copy ("A deadline draws near", "The Tome stirs")
- [~] Permission request shown, exposed in Settings; onboarding-time prompt deferred to Phase 5 polish

## 4.4 Quest Log & History
- [x] Active quests view (default Quest Board)
- [x] Completed quests log (with completion dates, XP earned)
- [x] Abandoned quests log
- [x] Search and filter by faction, tier, date range

## 4.5 Settings
- [x] Difficulty toggle (Apprentice / Adept / Master / Legendary), exposed on the Character Sheet; mid-campaign change applies to the next completion only (not retroactive)
- [~] Notification preferences, daily check-in time picker live; per-deadline-reminder toggles deferred
- [~] Audio settings, cinematic mute toggle live; voiceover/ambient toggles deferred until those tracks exist
- [ ] Theme toggle (dark / light), deferred (significant restyle)
- [x] `+chronicle` export, downloads full state as plain text on web, hands off to the Share sheet on native
- [~] Account management, change email, send password reset; account deletion deferred to an admin edge function

## Phase 4 Definition of Done
- Recurring quests cycle correctly across timezone changes and DST
- Debuffs trigger and clear as specified
- Notifications work reliably on iOS and Android (test 50+ scheduled events)
- A beta user can use the app as their primary task manager for 7 days without bugs

---

# PHASE 5, MONETIZATION & LAUNCH

**Goal:** Ship to the App Store and Google Play. Validate with real users.

**Duration estimate:** Weeks 14-16.

**Exit criteria:** Live on both stores. First 100 users acquired. First paying subscriber.

## 5.1 RevenueCat Integration
- [ ] Configure products in App Store Connect and Google Play Console, needs your hand
- [ ] Subscription tiers (revised, three durations grant the same entitlement):
  - **Free**, full character creation + cinematic + every mechanic. Capped at 5 active quests at any one time.
  - **Hero (Questline Pro entitlement)**, uncaps active-quest count. Three pledges:
    - **Lifetime** ($59.99 one-time)
    - **Yearly** ($29.99/yr, best value)
    - **Monthly** ($2.99/mo)
- [x] Quest-cap enforcement (server-side trigger)
- [x] Paywall screen, `app/(main)/paywall.tsx`. On native + RC configured, renders `RevenueCatUI.PaywallView` (dashboard-built, A/B-testable). On web / unconfigured falls back to a custom in-world picker with all three tiers.
- [x] Hero upgrade cinematic, `app/(main)/hero-cinematic.tsx`, plays on purchase / restore success
- [x] react-native-purchases + react-native-purchases-ui SDKs installed; `lib/purchases.ts` wrapper handles configure / login / logout / package fetch / purchase / restore / customer-info, gracefully no-ops on web
- [x] Customer Center, `app/(main)/customer-center.tsx`, renders `RevenueCatUI.CustomerCenter` for Hero users. Free users see the paywall instead.
- [ ] Free trial: 7 days, configure in RC dashboard once products exist
- [x] Restore purchases flow, wired in paywall
- [x] Receipt validation server-side, `supabase/functions/revenuecat-webhook/index.ts`, deployed; expects bearer-token shared secret in Authorization header
- [x] Test API key wired in `.env.local` for paywall iteration without App Store products

## 5.2 Onboarding Polish
- [~] First-launch flow: cinematic → character creation → first quest. Permission requests integrated into Settings rather than gated upfront.
- [x] Tutorial overlays on key screens (dismissible, never re-shown), `components/tutorial-overlay.tsx`, mounted at the (main) layout root, fires on first visit, AsyncStorage-backed so it stays dismissed. Five-step orientation in Archivist voice; Settings → "Replay orientation" resets the flag for users who want a refresher.
- [~] Empty states with Archivist flavor text, Quest Board / Character Sheet / XP History all in voice; could be tightened further pre-launch
- [~] Error states designed in-world, most error toasts are in voice; raw RPC errors still leak through occasionally

## 5.3 App Store Assets
- [ ] App icon (final, all required sizes)
- [ ] Screenshots: 6 per device size, hero shots from cinematic + character sheet + quest board
- [ ] App preview video (15-30s), cinematic excerpt + key features
- [x] Privacy policy, live at https://mitchelprice93-stack.github.io/Questline/privacy/, lawyer-reviewed, parchment-themed; URL wired in `.env.local`; linked from Settings → Legal
- [x] Terms of service, live at https://mitchelprice93-stack.github.io/Questline/terms/, same flow; Texas governing law
- [x] Bundle identifiers, `com.mitchelprice.questline` for both iOS and Android, set in app.json
- [x] iOS export-compliance flag, `usesNonExemptEncryption: false` set so TestFlight builds skip the per-build prompt
- [x] Support email, questline.customerservice@gmail.com (in privacy + terms)
- [~] App icon, leather-and-gold design saved to `assets/images/icon.png` + `android-icon-foreground.png` + `favicon.png`. Android adaptive-icon background updated to `#3f2e1d` (dark sepia) to match leather. Foreground may need a transparent-bg version once shipped to a device, depending on how Android crops it.
- [x] App Store copy drafts, `prompts/app-store-copy-draft.md` covers subtitle, description, keywords, promotional text, privacy nutrition labels, support URL, ready to paste when App Store Connect signup happens
- [ ] App Store copy:
  - Subtitle (30 chars): "Your life, as a quest"
  - Description (4000 chars): emphasize productivity + magic, target ADHD/gamification audiences
  - Keywords (100 chars): research with App Store Connect's tools
- [ ] Privacy policy + terms of service (required, use a generator like Termly, customize)
- [ ] Support URL (a simple landing page or email)

## 5.4 Beta Testing
- [ ] TestFlight build distributed to 20-30 testers (mix of YouTube audience + friends)
- [ ] Google Play internal testing track parallel
- [ ] Feedback form (PostHog or Tally)
- [ ] 2-week beta minimum before submission
- [ ] Critical bugs fixed; nice-to-haves go to Phase 2 Vault

## 5.5 Soft Launch
- [ ] Submit to App Store + Google Play, restricted to one country (Canada or Australia)
- [ ] Monitor crash rates, retention, conversion for 1-2 weeks
- [ ] Fix critical issues; expand to US once stable
- [ ] Begin YouTube launch content (build series, behind-the-scenes, walkthrough)

## Phase 5 Definition of Done
- App is live on both stores
- 50+ real users
- 5+ paying subscribers
- Crash-free rate > 99.5%
- Day-7 retention > 25%

---

# DATABASE SCHEMA

```sql
-- Users (extends Supabase auth.users)
profiles (
  id uuid primary key references auth.users,
  display_name text,
  character_name text,
  character_title text,
  level int default 1,
  total_xp bigint default 0,
  difficulty text default 'adept', -- apprentice|adept|master|legendary
  created_at timestamptz default now()
)

-- Factions (user's life domains, AI-named)
factions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles not null,
  name text not null,           -- "The Void Walker's Guild"
  real_world_domain text not null, -- "Axiom Space EVA Tech"
  created_at timestamptz default now()
)

-- Campaigns (long-term goals/arcs)
campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles not null,
  faction_id uuid references factions,
  arc_name text not null,
  real_world_goal text not null,
  progress_pct int default 0,
  status text default 'active', -- active|completed|abandoned
  created_at timestamptz default now()
)

-- Quests
quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles not null,
  faction_id uuid references factions,
  campaign_id uuid references campaigns,
  title text not null,
  description text,
  objectives jsonb default '[]'::jsonb, -- [{text, completed}]
  tier text not null, -- trivial|minor|standard|major|legendary
  classification text not null, -- daily|side|main|legendary
  xp_reward int not null,
  status text default 'active', -- active|completed|abandoned
  recurrence text, -- null|daily|weekly
  streak_count int default 0,
  deadline timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
)

-- XP log (audit trail, never deleted)
xp_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles not null,
  quest_id uuid references quests,
  xp_change int not null,
  reason text not null, -- "quest_complete"|"buff_bonus"|"debuff_penalty"
  created_at timestamptz default now()
)

-- Buffs & Debuffs
modifiers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles not null,
  type text not null, -- buff|debuff
  name text not null,
  effect_description text,
  xp_modifier_pct int default 0, -- e.g. -10 for -10%
  expires_at timestamptz,
  created_at timestamptz default now()
)

-- AI call audit (for cost monitoring)
ai_call_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,6),
  endpoint text, -- 'character_creation' | 'quest_generation' | etc
  created_at timestamptz default now()
)

-- Subscriptions (RevenueCat sync target)
subscriptions (
  user_id uuid primary key references profiles,
  tier text default 'free', -- free|hero
  status text, -- active|trial|expired|cancelled
  expires_at timestamptz,
  rc_customer_id text,
  updated_at timestamptz default now()
)
```

All tables: enable RLS, policy `auth.uid() = user_id`.

---

# PHASE 2 VAULT (DO NOT BUILD IN V1)

The following ideas are good. They are not v1. Anything that comes up during build that isn't on the Phase 1-5 list goes here.

- Multiplayer guilds / shared quest boards
- AI-generated quest illustrations (per quest, costly)
- Custom Archivist voice packs (premium upsell)
- Apple Health / Google Fit integration (auto-quests for workouts)
- Theme packs (cyberpunk, sci-fi, lovecraftian, etc.)
- Web companion app
- Calendar integration (auto-create quests from calendar events)
- Cross-faction synergy bonuses
- "World events", global community challenges
- Skill trees per faction
- Inventory mechanics tied to quests
- Photo journaling on quest completion
- AI-generated lore expansion ("write the next chapter of my chronicle")

---

# DEVELOPMENT WORKFLOW NOTES FOR CLAUDE CODE

When working on this project:

1. **Always check this file before starting a new task.** It is the source of truth.
2. **Never skip phases.** If you find yourself wanting to add audio in Phase 1, stop. Note the idea in the Vault.
3. **Write tests for the XP engine before writing UI.** No exceptions.
4. **Treat the system prompt as production code.** Version it. Don't edit it casually.
5. **Cost-conscious AI usage.** Before adding any new Claude API call, ask: can this be Haiku instead of Sonnet? Can it be cached? Can it be templated?
6. **Commit messages reference phase + task** (e.g., `[1.4] add level threshold calculator`).
7. **When in doubt, ship the boring version first.** Magic is added in Phase 3, not Phase 1.

---

# OPEN QUESTIONS / DECISIONS PENDING

- [ ] Final app name confirmed: **Questline** ✓
- [ ] App Store name availability, verify before public commits
- [ ] `.app` and `.com` domain availability, verify
- [ ] Trademark search (USPTO TESS), recommended before launch
- [ ] Final illustrator selection
- [ ] Final ElevenLabs voice selection (test "Daniel" and "George")
- [ ] Pricing finalized: $4.99/mo, $39/yr, 7-day trial, subject to A/B test post-launch

---

*End of v1 spec. Begin with Phase 1.1.*
