# Questline · Privacy Policy

> **DRAFT — review with legal counsel before publishing.** This document
> describes the data Questline actually handles as of the latest commit;
> it has not been reviewed by an attorney and may not satisfy every
> jurisdiction's requirements (GDPR, CCPA, COPPA, etc.). Treat as a
> starting point.

**Effective date:** _replace before publication_
**Last updated:** _replace before publication_

## Who we are

Questline is a productivity app that frames real-life endeavors as RPG
quests. The app and this policy are operated by Mitchel Price. You can
reach us at the support address listed on our App Store / Google Play
listing.

## What this policy covers

This policy explains what information Questline collects, how we use
it, who we share it with, and the rights you have over it. It applies
to the Questline iOS and Android apps and any related services we
operate.

## Information we collect

### You provide it directly

- **Email address** when you sign up. Used to authenticate you and to
  send transactional messages (password resets, email-change
  confirmations).
- **Character details**: the name, title, factions, campaigns,
  background, and life summary you enter during character creation.
- **Quest content**: titles, descriptions, deadlines, objectives, and
  any text you type into the app while creating or editing quests.

### Generated as you use the app

- **Activity records**: completion timestamps, abandonment timestamps,
  XP balances, level history, streak counts, modifier (buff/debuff)
  state.
- **AI usage logs**: input/output token counts and cost-in-USD for each
  AI call, attributed to your account, used for billing-cap
  enforcement and abuse prevention. We do not retain the prompts or
  responses themselves beyond what's already saved as your quest /
  character content.
- **Audit log**: every XP change is recorded with its reason
  ("quest_complete", "streak_bonus_7", etc.) for the in-app XP History
  screen.

### Device and notification data

- **Push notification token** (if you grant notification permission),
  used to send you app-related notifications (deadline reminders,
  daily check-ins). We do not use push for marketing.
- **Local preferences** (audio mute state, daily check-in time,
  cinematic-seen flag) stored only on your device via local
  storage; never transmitted to our servers.

### Subscription data (if you pledge to Hero)

- Receipt validation events from RevenueCat (subscription start,
  renewal, cancellation, expiration). We store your tier and expiry,
  not the underlying receipt itself.

## How we use this information

- **Operate the app**: render your character sheet, quest board,
  modifiers, history.
- **Authenticate you**: verify your email and password on every sign-in.
- **Generate AI narrative**: send your quest input and a compact
  character snapshot to our AI provider to forge in-voice narrative.
- **Enforce limits**: count active quests against your tier's cap;
  rate-limit AI generation; cap daily AI cost per user.
- **Notify you**: deadline reminders and (optional) daily check-ins.
- **Bill you**: process and track your subscription via RevenueCat.

We do not sell your data. We do not use your data for advertising. We
do not run analytics or behavioral tracking SDKs in the app.

## Third parties we share data with

| Service | What they receive | Purpose |
|---|---|---|
| **Supabase** (database, auth) | Email, hashed password, all account data | Hosting our database and authentication. Data stored in their US region. |
| **Anthropic** (Claude AI) | Your quest input + a compact character snapshot at the moment of an AI call | Generating in-voice narrative. Calls go through our edge function; our Anthropic account is the customer of record. |
| **RevenueCat** (subscriptions) | Your account ID, subscription state, receipt | Processing and validating in-app purchases. |
| **Apple / Google** (in-app purchases) | Payment information, subscription state | Processing the actual purchase. We never see your payment details. |
| **Expo** (push notifications) | Push token | Delivering local + remote notifications you've requested. |

Each of these providers has its own privacy policy. Links available on
request.

## Data retention

- **Account data** (profile, quests, modifiers) is retained as long as
  your account exists.
- **AI call logs** are retained for 90 days for billing reconciliation,
  then deleted.
- **Cancelled subscriptions** retain their record for tax / accounting
  purposes for the duration required by law (typically 7 years), but
  you can request deletion of personal identifiers.

When you delete your account from inside the app (Settings → Delete
account), we cascade-delete every row associated with you across
every table within 24 hours, with the exceptions noted above.

## Your rights

Depending on where you live, you have the right to:

- **Access** the data we hold about you. The in-app `+chronicle` export
  (Settings → Transcribe the Tome) gives you a plaintext copy of
  everything; for anything beyond that, contact support.
- **Correct** inaccurate data. Most fields you can edit in-app; for
  the rest, contact support.
- **Delete** your account and data. Settings → Delete account.
- **Object** to processing or **withdraw consent** for any processing
  based on consent (e.g., notifications — toggle off in Settings).
- **Port** your data to another service. Use `+chronicle` or contact
  support for a structured export.

## Children

Questline is not intended for users under 13 (or 16 in jurisdictions
that require it). We do not knowingly collect data from children. If
you believe a child has signed up, contact us and we'll delete the
account.

## Changes to this policy

When we change this policy materially we'll update the "Last updated"
date and notify you in-app at next sign-in. Continued use after the
change constitutes acceptance.

## Contact

Email: _replace with your support email before publication_

---

_DRAFT — pending legal review_
