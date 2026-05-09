# Questline · App Store / Play Store Copy

Drafts for every text field App Store Connect and Google Play Console
ask for. Two of each kind for the major fields so you can pick the one
that lands. Keep these here for reference — when you submit to the
stores, paste / iterate as needed.

---

## App name

**Questline** (10 chars)

## Subtitle / short description (App Store: 30 chars / Play Store: 80 chars)

**Option A (20 chars):** `Your life, as a quest`
*Spec-canonical. Mysterious, in-voice, doesn't try to compete on SEO.*

**Option B (30 chars):** `Productivity, as an RPG quest`
*Tells you what the app is upfront. Less mysterious, more Google-friendly.*

**Recommendation:** A for App Store (premium feel), B for Play Store (more SEO).

---

## Promotional text (App Store, 170 chars — updatable without resubmit)

> The Tome opens once more. Each task you complete is inscribed by the
> Archivist of Fate; each oath kept earns its own line in your chronicle.

(167 chars)

Use this slot for limited-time messaging once you're shipping
(announcements, seasonal events, milestones). For launch, the line
above sets the tone without overpromising.

---

## Description (App Store: 4000 chars / Play Store: 4000 chars)

> Questline turns your real life into an RPG chronicle.
>
> Every task is a quest. Every quest is forged into the Archivist's
> voice — given a tier, a description, an objective list, and a buff
> the chronicler can earn for finishing on time. Complete it, and the
> Tome inscribes the deed; level up enough times and the chronicle
> thickens. Let it slide past its deadline, and the Cobwebs of
> Procrastination settle in.
>
> THIS IS NOT ANOTHER TASK APP
>
> The Archivist of Fate watches over your endeavors. When you describe
> what you need to do — finish the lab report, run the half-marathon,
> finally call the dentist — the Tome reframes it as a quest worthy of
> recording. The narrative is the whole point. You feel the weight of
> a major undertaking differently when the Archivist names it
> "legendary"; you feel the pull of a daily routine differently when
> your streak crosses 7 days and a Sage's Insight lands on your
> character sheet.
>
> WHAT THE TOME REMEMBERS
>
> · Quests with tiers, classifications, and AI-generated objectives
> · Daily and weekly recurring quests with streak tracking
> · Granted buffs that scale with quest difficulty and persist across
>   completions
> · Debuffs when deadlines pass — and a +rest invocation to clear the
>   stalest ones once a week
> · Factions, campaigns, and a chronicle of every XP gain you've earned
> · A cinematic intro narrated in the Archivist's voice
>
> FREE TO BEGIN
>
> Hold up to five active quests at any time on the Free tier.
> Everything else — character creation, the cinematic, every mechanic,
> every animation — opens to you without payment.
>
> PLEDGE YOUR OATH (HERO)
>
> Pledged chroniclers carry as many endeavors as their week demands.
> Lifetime, yearly, and monthly pledges available. Cancel any time
> from your platform's subscription settings.
>
> Your chronicle is yours. The +chronicle export gives you a plain-text
> copy of everything the Tome holds for you, any time. Account deletion
> from inside the app, no friction.
>
> Tell us, then. Who are you?

(About 1,800 chars — well under the 4,000 limit, leaves room to add a
"What's New in this version" preamble if you want.)

---

## Keywords (App Store, 100 chars total — comma-separated, no spaces around commas)

**Option A (productivity-leaning, 99 chars):**
```
quest,productivity,task,todo,habit,gamification,streak,planner,goals,journal,RPG,fantasy,game
```

**Option B (game-leaning, 99 chars):**
```
RPG,quest,fantasy,chronicle,journal,gamification,task,habit,streak,productivity,adventure,goal
```

**Recommendation:** A. The app's *audience* is people who already
search "task / habit / planner" and would smile at finding an RPG
take. Game-heavy keywords pull in players who want a game and bounce
off finding a productivity tool.

(Don't include words that are in the app name or subtitle — Apple
auto-indexes those. So "Questline" doesn't need to be in the keyword
list.)

---

## Category (App Store + Play Store)

**Primary:** Productivity
**Secondary:** Lifestyle (App Store only allows one secondary)

The temptation is to pick "Games" because the app *feels* like one,
but the user is buying it for productivity outcomes. Apple's algorithm
is more lenient with cross-category niches in productivity than in
games (where casual-game saturation is brutal).

---

## Age rating

**4+** (App Store) / **Everyone** (Google Play).

The Archivist's prompt is hard-walled against self-harm, weapons,
substance abuse, sexual content, etc. There's no user-to-user
communication, no in-app chat, no UGC visible to other users. Should
clear all rating criteria.

---

## Privacy details (App Store privacy nutrition labels)

When App Store Connect asks the data-collection questions, here's
what to declare:

| Data type | Linked to user | Used for tracking | Purpose |
|---|---|---|---|
| Email | Yes | No | App functionality, account |
| User content (quests, character data) | Yes | No | App functionality |
| Diagnostics (AI usage logs) | Yes | No | App functionality, analytics |
| Identifiers (account ID for RC) | Yes | No | App functionality, purchases |

Things we explicitly DO NOT collect:
- Location (in any form)
- Contacts
- Photos / media
- Health & fitness
- Financial info (RevenueCat handles this; we never see card data)
- Browsing / search history
- Sensitive demographic info

---

## What's New (per-version release notes)

For v0.1.0 / v1.0 / first ship:

> The Tome opens for the first time. The Archivist of Fate awaits the
> chronicler's first inscription.

For minor updates afterward, follow the pattern: in-voice line +
optional one-line bullet list of meaningful changes. Examples:

> Buffs persist longer. The Archivist remembers more than he lets on.
> · Buff lifetimes now scale with quest tier — up to 14 days for legendary deeds
> · Same-name buffs refresh instead of stacking

---

## Support URL

Once questline.customerservice@gmail.com is monitored, this URL
suffices for Apple's "support URL" requirement: a `mailto:` link in
the app or a Notion / Linktree page that points back to that email.
Apple wants something a user can click to reach you. We can host a
minimal "Contact" page on the same GitHub Pages site if needed:

```
https://mitchelprice93-stack.github.io/Questline/contact/
```

(Add `docs/contact.md` with `permalink: /contact/` when you want this.)

---

## Marketing URL (optional)

Same GitHub Pages site is fine for launch:

```
https://mitchelprice93-stack.github.io/Questline/
```

If you ever want a dedicated domain (`questline.app` is probably
taken; `getquestline.com` likely isn't), it's a $12/yr domain
registration + a one-line `CNAME` file in the docs/ folder.
