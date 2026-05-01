# Questline

A cross-platform mobile RPG quest-board app. Real-world tasks, gamified through a Skyrim/Harry Potter-inspired framework. Built with React Native + Expo.

> **Source of truth:** all v1 scope, architecture, and build order live in [`QUESTLINE_PROJECT.md`](./QUESTLINE_PROJECT.md). Always check that doc before starting a task.

## Stack

- React Native + Expo (managed workflow, SDK 54)
- TypeScript (strict, `noUncheckedIndexedAccess`)
- Expo Router (file-based, typed routes)
- NativeWind v4 (Tailwind for RN)
- ESLint + Prettier

Backend, AI, audio, animations, and monetization land in later phases per the spec.

## Quickstart

```bash
npm install
npx expo start --web   # primary dev target on Windows
```

Other targets:

```bash
npx expo start --android   # requires Android Studio + emulator
npx expo start --ios       # requires macOS
```

## Scripts

- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — `expo lint` (Expo's ESLint flat config + Prettier)
- `npm run format` / `npm run format:check` — Prettier

## Project structure

```
app/
  _layout.tsx              # root Stack; imports global.css
  index.tsx                # entry redirect (Phase 1.3 will make it auth-aware)
  (auth)/                  # login, signup
  (onboarding)/            # cinematic, character-creation
  (main)/                  # quest-board, character-sheet, settings
```

## Phase status

Tracking against the spec's phase plan:

- [x] **1.1** Project initialization (this commit)
- [ ] 1.2 Supabase setup
- [ ] 1.3 Authentication
- [ ] 1.4 XP engine (pure TS + Jest, before any UI work that depends on XP)
- [ ] 1.5 Quest CRUD
- [ ] 1.6 Character sheet (basic)

See [`QUESTLINE_PROJECT.md`](./QUESTLINE_PROJECT.md) for the full roadmap.
