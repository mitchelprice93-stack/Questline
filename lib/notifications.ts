// Phase 4.3 — local notifications.
//
// Web: expo-notifications has no scheduling API in the browser, so every
// helper here returns gracefully (early return / null). On native we ask
// for permission, schedule deadline reminders 24h + 1h before, and a
// configurable daily check-in nudge.
//
// Remote push (debuff warnings, etc.) is deferred to a follow-up that
// stores Expo push tokens server-side and dispatches via an edge function.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { errorMessage } from './errors';
import { supabase } from './supabase';

// AsyncStorage keys.
const KEY_QUEST_NOTIFICATIONS = 'questline.notifications.questIds'; // map quest_id -> [scheduledIds]
const KEY_CHECK_IN_TIME = 'questline.notifications.checkInTime'; // 'HH:MM' or 'off'
const KEY_CHECK_IN_NOTIF = 'questline.notifications.checkInId'; // current scheduled id

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

// Foreground display behavior — show banner + sound while the app is open
// instead of silently dropping the notification.
if (isNative) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function getPermissionStatus(): Promise<PermissionStatus> {
  if (!isNative) return 'unsupported';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'undetermined';
  } catch {
    return 'unsupported';
  }
}

export async function requestPermission(): Promise<PermissionStatus> {
  if (!isNative) return 'unsupported';
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === 'granted') {
      // Best-effort: register the device for remote push so the daily
      // debuff cron can find a token to dispatch to. Non-fatal if the
      // token fetch or upsert fails.
      void registerPushTokenForCurrentUser();
      return 'granted';
    }
    if (status === 'denied') return 'denied';
    return 'undetermined';
  } catch {
    return 'unsupported';
  }
}

// ---- Remote push token registration ----------------------------------------

/**
 * Fetch this device's Expo push token and upsert it into the push_tokens
 * table. Called on permission grant and on session change. No-op on web.
 *
 * Expo's push system requires a `projectId` from app.json. If that's
 * missing (e.g. local dev without EAS-linked project) we silently skip
 * registration — local notifications still work.
 */
export async function registerPushTokenForCurrentUser(): Promise<void> {
  if (!isNative) return;
  try {
    const status = await getPermissionStatus();
    if (status !== 'granted') return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn(
        '[push] no EAS projectId; skipping push token registration. ' +
          'Run `eas init` and add the projectId to app.json once available.',
      );
      return;
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoToken = tokenResponse.data;
    if (!expoToken) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('push_tokens')
      .upsert({ user_id: user.id, expo_token: expoToken, updated_at: new Date().toISOString() });
  } catch (e) {
    // Swallow — push registration failure shouldn't disrupt the app.
    console.warn('[push] registerPushTokenForCurrentUser failed', errorMessage(e));
  }
}

// ---- Deadline reminders ----------------------------------------------------

interface QuestNotifMap {
  [questId: string]: string[];
}

async function readQuestNotifMap(): Promise<QuestNotifMap> {
  try {
    const raw = await AsyncStorage.getItem(KEY_QUEST_NOTIFICATIONS);
    return raw ? (JSON.parse(raw) as QuestNotifMap) : {};
  } catch {
    return {};
  }
}

async function writeQuestNotifMap(map: QuestNotifMap): Promise<void> {
  await AsyncStorage.setItem(KEY_QUEST_NOTIFICATIONS, JSON.stringify(map));
}

/**
 * Cancel any previously-scheduled reminders for the given quest. Called
 * from scheduleDeadlineReminders before re-scheduling, and on quest
 * completion / abandonment.
 */
export async function cancelDeadlineReminders(questId: string): Promise<void> {
  if (!isNative) return;
  try {
    const map = await readQuestNotifMap();
    const ids = map[questId] ?? [];
    await Promise.all(
      ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)),
    );
    delete map[questId];
    await writeQuestNotifMap(map);
  } catch (e) {
    console.warn('cancelDeadlineReminders failed', errorMessage(e));
  }
}

/**
 * Schedule reminder notifications for a quest's deadline at 24h-before and
 * 1h-before. Past timestamps are skipped, so a deadline 30 minutes from now
 * will only get the 1h reminder (which has already passed) and effectively
 * be a no-op — that's fine.
 *
 * Idempotent: cancels any prior reminders for this quest first.
 */
export async function scheduleDeadlineReminders(
  questId: string,
  questTitle: string,
  deadlineIso: string | null,
): Promise<void> {
  if (!isNative) return;
  await cancelDeadlineReminders(questId);
  if (!deadlineIso) return;

  const status = await getPermissionStatus();
  if (status !== 'granted') return; // silently skip — user can grant later

  const deadline = new Date(deadlineIso);
  if (isNaN(deadline.getTime())) return;

  const now = Date.now();
  const oneHourBefore = deadline.getTime() - 60 * 60 * 1000;
  const oneDayBefore = deadline.getTime() - 24 * 60 * 60 * 1000;

  const ids: string[] = [];

  try {
    if (oneDayBefore > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'A deadline draws near',
          body: `"${questTitle}" comes due tomorrow.`,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(oneDayBefore),
        },
      });
      ids.push(id);
    }
    if (oneHourBefore > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'The hour approaches',
          body: `"${questTitle}" is due in an hour.`,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(oneHourBefore),
        },
      });
      ids.push(id);
    }
  } catch (e) {
    console.warn('scheduleDeadlineReminders failed', errorMessage(e));
  }

  if (ids.length > 0) {
    const map = await readQuestNotifMap();
    map[questId] = ids;
    await writeQuestNotifMap(map);
  }
}

// ---- Daily check-in --------------------------------------------------------

/** Returns 'HH:MM' or 'off'. Default 'off' until the user opts in. */
export async function getCheckInTime(): Promise<string> {
  return (await AsyncStorage.getItem(KEY_CHECK_IN_TIME)) ?? 'off';
}

/**
 * Persist the user's preferred daily check-in time and (re)schedule the
 * recurring local notification. Pass 'off' to disable.
 */
export async function setCheckInTime(time: 'off' | string): Promise<void> {
  await AsyncStorage.setItem(KEY_CHECK_IN_TIME, time);

  if (!isNative) return;

  // Cancel any existing scheduled check-in.
  const prev = await AsyncStorage.getItem(KEY_CHECK_IN_NOTIF);
  if (prev) {
    await Notifications.cancelScheduledNotificationAsync(prev).catch(() => undefined);
    await AsyncStorage.removeItem(KEY_CHECK_IN_NOTIF);
  }
  if (time === 'off') return;

  const status = await getPermissionStatus();
  if (status !== 'granted') return;

  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr ?? '8', 10);
  const minute = parseInt(minuteStr ?? '0', 10);
  if (isNaN(hour) || isNaN(minute)) return;

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'The Tome stirs',
        body: 'A new day awaits inscription. What will you set your hand to?',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        hour,
        minute,
        repeats: true,
      },
    });
    await AsyncStorage.setItem(KEY_CHECK_IN_NOTIF, id);
  } catch (e) {
    console.warn('setCheckInTime schedule failed', errorMessage(e));
  }
}
