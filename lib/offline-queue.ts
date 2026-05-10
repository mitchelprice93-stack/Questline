// Offline write queue — companion to lib/offline.ts's read-cache.
//
// Mutations that hit the network (e.g. createQuest) try the server first.
// On network failure they're enqueued to AsyncStorage; an optimistic copy
// of the result is also injected into the read-cache so the user sees
// their work immediately. The next time the app foregrounds, drainQueue
// replays the pending mutations against the server.
//
// Scope (v1): completeQuest — the offline-failure path that matters
// most for testing on phones away from wifi. Quest creation stays
// online-only (the user prefers a clear "save failed" over a hidden
// queued draft). createQuest / abandonQuest can be added to the
// queue later if needed; the infrastructure is generic.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { errorMessage } from './errors';

const KEY = 'questline.offline.queue.v1';
/** After this many failed drains, drop the mutation rather than retry forever. */
const MAX_ATTEMPTS = 5;

export type MutationKind = 'completeQuest';

export interface QueuedMutation {
  /** Local id for the queue entry — distinct from any server-side id the
   *  payload may eventually receive. */
  id: string;
  kind: MutationKind;
  /** Serialized handler input. Typed at the handler boundary, not here. */
  payload: unknown;
  queuedAt: string;
  attempts: number;
}

type Handler = (payload: unknown) => Promise<void>;
const handlers = new Map<MutationKind, Handler>();

/** Register the function that knows how to replay a given mutation kind.
 *  Called at module load time by lib/quests.ts (and any future module
 *  that contributes mutation handlers). */
export function registerHandler(kind: MutationKind, handler: Handler): void {
  handlers.set(kind, handler);
}

let listeners: ((count: number) => void)[] = [];

async function readQueue(): Promise<QueuedMutation[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[offline-queue] readQueue failed', errorMessage(e));
    return [];
  }
}

async function writeQueue(mutations: QueuedMutation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(mutations));
  } catch (e) {
    console.warn('[offline-queue] writeQueue failed', errorMessage(e));
  } finally {
    // Notify listeners regardless of write success — the in-memory state
    // is what the UI reads next, and the write failure is best-effort.
    listeners.forEach((l) => l(mutations.length));
  }
}

function tempId(): string {
  // Unique-enough for queue bookkeeping; not a UUID. Deliberately prefixed
  // so callers can detect "this is a temp id" via startsWith('tmp_').
  return 'tmp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Add a mutation to the queue. Returns the queue entry's local id. */
export async function enqueue(kind: MutationKind, payload: unknown): Promise<string> {
  const queue = await readQueue();
  const mutation: QueuedMutation = {
    id: tempId(),
    kind,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  queue.push(mutation);
  await writeQueue(queue);
  return mutation.id;
}

/** Try every queued mutation in order. Successful ones are removed; failed
 *  ones stay (with bumped attempt count) unless they've hit MAX_ATTEMPTS,
 *  at which point they're dropped to keep the queue from growing forever. */
export async function drainQueue(): Promise<{ replayed: number; remaining: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { replayed: 0, remaining: 0 };

  let replayed = 0;
  const stillPending: QueuedMutation[] = [];

  for (const mutation of queue) {
    const handler = handlers.get(mutation.kind);
    if (!handler) {
      // Handler not registered yet (module load order). Keep queued.
      stillPending.push(mutation);
      continue;
    }
    try {
      await handler(mutation.payload);
      replayed++;
    } catch (e) {
      const next: QueuedMutation = { ...mutation, attempts: mutation.attempts + 1 };
      if (next.attempts >= MAX_ATTEMPTS) {
        console.warn(
          '[offline-queue] dropping after max attempts',
          mutation.kind,
          errorMessage(e),
        );
        // Counts as "handled" — the user's not getting it back regardless.
        replayed++;
      } else {
        stillPending.push(next);
      }
    }
  }

  await writeQueue(stillPending);
  return { replayed, remaining: stillPending.length };
}

export async function getQueueSize(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

export function subscribeToQueue(listener: (count: number) => void): () => void {
  listeners.push(listener);
  // Fire once with current size so subscribers don't have to also call
  // getQueueSize themselves.
  void getQueueSize().then(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Heuristic: is this error caused by missing network connectivity?
 *  Used by mutation wrappers to decide whether to queue or rethrow. */
export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const m = e.message.toLowerCase();
  return (
    m.includes('network request failed') ||
    m.includes('failed to fetch') ||
    m.includes('load failed') ||
    m.includes('networkerror') ||
    m.includes('typeerror') // RN Web throws TypeError on offline fetch
  );
}

let initialized = false;

/** Wire up automatic drain. Called once from the (main) layout. Drains
 *  on initial app load and whenever the app foregrounds (covers the
 *  "user reconnected to wifi while app was backgrounded" case). */
export function initOfflineQueue(): void {
  if (initialized) return;
  initialized = true;

  // Initial drain — defer one tick so module-load-time handler registration
  // has finished before we start firing handlers.
  setTimeout(() => {
    void drainQueue();
  }, 0);

  AppState.addEventListener('change', (state) => {
    if (state === 'active') void drainQueue();
  });
}
