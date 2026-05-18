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
const KEY_CHECK_IN_TIME = 'questline.notifications.checkInTime'; // LEGACY 'HH:MM' or 'off' — migrated on first read
const KEY_CHECK_IN_NOTIF = 'questline.notifications.checkInId'; // LEGACY single scheduled id — migrated on first read
const KEY_CHECK_IN_SCHEDULE = 'questline.notifications.checkInSchedule'; // JSON of CheckInSchedule
const KEY_CHECK_IN_NOTIF_IDS = 'questline.notifications.checkInIds'; // JSON array of scheduled ids
const KEY_AUTO_PROMPT_SHOWN = 'questline.notifications.autoPromptShown'; // boolean

/**
 * Has the just-in-time permission prompt already been shown to this device?
 * Used by the quest-creation flow to prompt for notifications the FIRST
 * time a chronicler creates a recurring (daily/weekly) quest — that's the
 * moment notifications actually matter. After that, they can toggle from
 * Settings if they declined.
 */
export async function hasShownAutoPrompt(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_AUTO_PROMPT_SHOWN)) === '1';
  } catch {
    return false;
  }
}

export async function markAutoPromptShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_AUTO_PROMPT_SHOWN, '1');
  } catch {
    // best-effort; worst case the user is prompted twice
  }
}

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

// ---- Check-in schedule -----------------------------------------------------
//
// The check-in nudge supports four cadences: off, daily, weekly (one weekday),
// and custom (any subset of weekdays). All cadences share one time-of-day —
// per-day times would mean a row-per-day editor and a more complex schedule
// shape; revisit if testers ask for it. Day indices use the JS Date.getDay()
// convention: 0 = Sunday … 6 = Saturday. The expo-notifications CALENDAR
// trigger uses 1 = Sunday … 7 = Saturday, so we offset by +1 when scheduling.

export type CheckInSchedule =
  | { cadence: 'off' }
  | { cadence: 'daily'; time: string }
  | { cadence: 'weekly'; time: string; weekday: number }
  | { cadence: 'custom'; time: string; days: number[] };

const DEFAULT_SCHEDULE: CheckInSchedule = { cadence: 'off' };

/**
 * Read the current schedule. Migrates the legacy `KEY_CHECK_IN_TIME` shape
 * (a bare 'HH:MM' or 'off' string) to the new JSON shape on first read so
 * users coming from an older OTA don't lose their existing time preference.
 */
export async function getCheckInSchedule(): Promise<CheckInSchedule> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CHECK_IN_SCHEDULE);
    if (raw) {
      const parsed = JSON.parse(raw) as CheckInSchedule;
      // Light shape check — anything malformed falls back to 'off'.
      if (parsed && typeof parsed === 'object' && 'cadence' in parsed) {
        return parsed;
      }
    }
    // Migrate legacy 'HH:MM' / 'off' string.
    const legacy = await AsyncStorage.getItem(KEY_CHECK_IN_TIME);
    if (legacy && legacy !== 'off' && /^\d{2}:\d{2}$/.test(legacy)) {
      const migrated: CheckInSchedule = { cadence: 'daily', time: legacy };
      await AsyncStorage.setItem(KEY_CHECK_IN_SCHEDULE, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_SCHEDULE;
}

/**
 * LEGACY shim — older callers may still import this. Returns 'off' or
 * 'HH:MM' derived from the new schedule. Daily/weekly/custom all surface
 * the underlying time; off returns 'off'.
 */
export async function getCheckInTime(): Promise<string> {
  const s = await getCheckInSchedule();
  return s.cadence === 'off' ? 'off' : s.time;
}

async function cancelExistingCheckInNotifs(): Promise<void> {
  if (!isNative) return;
  // New shape (JSON array of ids).
  try {
    const raw = await AsyncStorage.getItem(KEY_CHECK_IN_NOTIF_IDS);
    if (raw) {
      const ids = JSON.parse(raw) as string[];
      await Promise.all(
        ids.map((id) =>
          Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined),
        ),
      );
      await AsyncStorage.removeItem(KEY_CHECK_IN_NOTIF_IDS);
    }
  } catch {
    // ignore
  }
  // Legacy single id.
  const legacyId = await AsyncStorage.getItem(KEY_CHECK_IN_NOTIF);
  if (legacyId) {
    await Notifications.cancelScheduledNotificationAsync(legacyId).catch(() => undefined);
    await AsyncStorage.removeItem(KEY_CHECK_IN_NOTIF);
  }
}

const CHECK_IN_CONTENT = {
  title: 'The Tome stirs',
  body: 'A new day awaits inscription. What will you set your hand to?',
};

/**
 * Persist the schedule and (re)schedule the corresponding local notifications.
 * Single source of truth for both writes — callers don't need to cancel first.
 */
export async function setCheckInSchedule(schedule: CheckInSchedule): Promise<void> {
  await AsyncStorage.setItem(KEY_CHECK_IN_SCHEDULE, JSON.stringify(schedule));
  // Keep the legacy time key roughly in sync so any stale consumer still
  // reading it sees a sane value. Safe to drop entirely after one release.
  await AsyncStorage.setItem(
    KEY_CHECK_IN_TIME,
    schedule.cadence === 'off' ? 'off' : schedule.time,
  );

  if (!isNative) return;
  await cancelExistingCheckInNotifs();
  if (schedule.cadence === 'off') return;

  const status = await getPermissionStatus();
  if (status !== 'granted') return;

  const [hourStr, minuteStr] = schedule.time.split(':');
  const hour = parseInt(hourStr ?? '8', 10);
  const minute = parseInt(minuteStr ?? '0', 10);
  if (isNaN(hour) || isNaN(minute)) return;

  // expo-notifications weekday: 1=Sunday..7=Saturday. JS Date: 0=Sunday..6=Saturday.
  const toExpoWeekday = (jsDay: number) => ((jsDay % 7) + 1);

  const ids: string[] = [];
  try {
    if (schedule.cadence === 'daily') {
      const id = await Notifications.scheduleNotificationAsync({
        content: CHECK_IN_CONTENT,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          hour,
          minute,
          repeats: true,
        },
      });
      ids.push(id);
    } else if (schedule.cadence === 'weekly') {
      const id = await Notifications.scheduleNotificationAsync({
        content: CHECK_IN_CONTENT,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          weekday: toExpoWeekday(schedule.weekday),
          hour,
          minute,
          repeats: true,
        },
      });
      ids.push(id);
    } else if (schedule.cadence === 'custom') {
      // One repeating notification per selected weekday. Dedupe defensively.
      const uniq = Array.from(new Set(schedule.days)).filter(
        (d) => Number.isInteger(d) && d >= 0 && d <= 6,
      );
      for (const day of uniq) {
        const id = await Notifications.scheduleNotificationAsync({
          content: CHECK_IN_CONTENT,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            weekday: toExpoWeekday(day),
            hour,
            minute,
            repeats: true,
          },
        });
        ids.push(id);
      }
    }
    if (ids.length > 0) {
      await AsyncStorage.setItem(KEY_CHECK_IN_NOTIF_IDS, JSON.stringify(ids));
    }
  } catch (e) {
    console.warn('setCheckInSchedule schedule failed', errorMessage(e));
  }
}

/**
 * LEGACY shim — keeps the older single-time API working. Maps 'HH:MM' to
 * a daily cadence and 'off' to off. Internally calls setCheckInSchedule.
 */
export async function setCheckInTime(time: 'off' | string): Promise<void> {
  if (time === 'off') {
    await setCheckInSchedule({ cadence: 'off' });
    return;
  }
  await setCheckInSchedule({ cadence: 'daily', time });
}
