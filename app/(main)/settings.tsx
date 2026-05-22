import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { CollapsibleSection } from '../../components/collapsible-section';
import { useColorMode, type ColorModePreference } from '../../lib/color-mode';
// ScrollView from gesture-handler, not react-native. RN's ScrollView gets
// its responder stuck after a Modal dismiss on Android, eating the next
// tap as a potential scroll. See app/(main)/quest-board/[id].tsx for the
// full note.
import { ScrollView } from 'react-native-gesture-handler';

import {
  deleteAccount,
  requestEmailChange,
  requestPasswordReset,
  resetCharacter,
} from '../../lib/account';
import { useAuth } from '../../lib/auth';
import { useAudioMuted } from '../../lib/audio-prefs';
import { shareChronicle } from '../../lib/chronicle';
import { confirmDestructive, showInfoMessage } from '../../lib/dialogs';
import { errorMessage } from '../../lib/errors';
import { clearQuestCache } from '../../lib/offline';
import { ParchmentScreen } from '../../lib/parchment';
import { FREE_TIER_QUEST_CAP } from '../../lib/subscription';
import { resetTutorial } from '../../lib/tutorial';
import { useTutorial } from '../../lib/tutorial-context';
import {
  getCheckInSchedule,
  getPermissionStatus,
  requestPermission,
  setCheckInSchedule,
  type CheckInSchedule,
  type PermissionStatus,
} from '../../lib/notifications';
import { DropdownPicker, type DropdownOption } from '../../components/dropdown-picker';

type Cadence = 'off' | 'daily' | 'weekly' | 'custom';

const CADENCE_OPTIONS: DropdownOption<Cadence>[] = [
  { value: 'off', label: 'Off', description: 'No check-in nudge.' },
  {
    value: 'daily',
    label: 'Daily',
    description: 'Every day at the chosen time.',
  },
  {
    value: 'weekly',
    label: 'Weekly',
    description: 'One day a week at the chosen time.',
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Pick any combination of days at one shared time.',
  },
];

// 24 hours expressed as 12-hour-clock labels. Internal value is HH (00..23).
const HOUR_OPTIONS: DropdownOption<string>[] = Array.from({ length: 24 }, (_, h) => {
  const period = h < 12 ? 'AM' : 'PM';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return {
    value: String(h).padStart(2, '0'),
    label: `${display} ${period}`,
  };
});

const MINUTE_OPTIONS: DropdownOption<string>[] = ['00', '15', '30', '45'].map((m) => ({
  value: m,
  label: `:${m}`,
}));

// 0 = Sunday … 6 = Saturday (JS Date.getDay convention).
const WEEKDAY_OPTIONS: DropdownOption<string>[] = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const DAY_CHIPS: { day: number; short: string }[] = [
  { day: 0, short: 'S' },
  { day: 1, short: 'M' },
  { day: 2, short: 'T' },
  { day: 3, short: 'W' },
  { day: 4, short: 'T' },
  { day: 5, short: 'F' },
  { day: 6, short: 'S' },
];

export default function Settings() {
  const { session, signOut, subscription, refetchProfile, resetCinematicSeen } = useAuth();
  const router = useRouter();
  const tutorial = useTutorial();

  const [muted, setMuted] = useAudioMuted();

  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null);
  // Check-in schedule, broken into editable pieces. cadence + time are always
  // editable; weekday is used when cadence='weekly'; days is used when
  // cadence='custom'. We persist by assembling these into a CheckInSchedule
  // on every change so the user never has to tap "Save".
  const [cadence, setCadence] = useState<Cadence>('off');
  const [hour, setHour] = useState<string>('08');
  const [minute, setMinute] = useState<string>('00');
  const [weekday, setWeekday] = useState<number>(1); // Monday default for weekly
  const [days, setDays] = useState<number[]>([1, 3, 5]); // Mon/Wed/Fri default for custom
  const [notifBusy, setNotifBusy] = useState(false);

  useEffect(() => {
    void getPermissionStatus().then(setPermissionStatus);
    void getCheckInSchedule().then((s) => {
      setCadence(s.cadence);
      if (s.cadence !== 'off') {
        const [h, m] = s.time.split(':');
        if (h) setHour(h.padStart(2, '0'));
        if (m) setMinute(m.padStart(2, '0'));
      }
      if (s.cadence === 'weekly') setWeekday(s.weekday);
      if (s.cadence === 'custom' && s.days.length > 0) setDays([...s.days].sort());
    });
  }, []);

  const onRequestPermission = async () => {
    setNotifBusy(true);
    try {
      const next = await requestPermission();
      setPermissionStatus(next);
    } finally {
      setNotifBusy(false);
    }
  };

  /** Build a CheckInSchedule from the current editor state. */
  const assembleSchedule = (overrides?: {
    cadence?: Cadence;
    hour?: string;
    minute?: string;
    weekday?: number;
    days?: number[];
  }): CheckInSchedule => {
    const c = overrides?.cadence ?? cadence;
    const time = `${overrides?.hour ?? hour}:${overrides?.minute ?? minute}`;
    if (c === 'off') return { cadence: 'off' };
    if (c === 'daily') return { cadence: 'daily', time };
    if (c === 'weekly') return { cadence: 'weekly', time, weekday: overrides?.weekday ?? weekday };
    const d = overrides?.days ?? days;
    // Empty custom selection falls back to daily so we never silently disable
    // the user, they explicitly chose Custom, they want SOMETHING scheduled.
    if (d.length === 0) return { cadence: 'daily', time };
    return { cadence: 'custom', time, days: d };
  };

  const persistSchedule = async (schedule: CheckInSchedule) => {
    setNotifBusy(true);
    try {
      await setCheckInSchedule(schedule);
    } catch (e) {
      console.warn('check-in schedule failed', e);
    } finally {
      setNotifBusy(false);
    }
  };

  const onCadenceChange = (next: Cadence) => {
    setCadence(next);
    void persistSchedule(assembleSchedule({ cadence: next }));
  };
  const onHourChange = (next: string) => {
    setHour(next);
    void persistSchedule(assembleSchedule({ hour: next }));
  };
  const onMinuteChange = (next: string) => {
    setMinute(next);
    void persistSchedule(assembleSchedule({ minute: next }));
  };
  const onWeekdayChange = (next: string) => {
    const w = parseInt(next, 10);
    setWeekday(w);
    void persistSchedule(assembleSchedule({ weekday: w }));
  };
  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    setDays(next);
    void persistSchedule(assembleSchedule({ days: next }));
  };

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [emailEditing, setEmailEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reset character, opens an inline "type DELETE to confirm" panel
  // before the wipe fires. Cancel-able until the user types and taps.
  const [resetStage, setResetStage] = useState<'idle' | 'confirming'>('idle');
  const [resetTypeInput, setResetTypeInput] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Public URLs for the privacy policy and terms of service. Once those
  // pages are hosted (GitHub Pages, Notion, Termly, your call), drop the
  // URLs into .env.local under EXPO_PUBLIC_PRIVACY_URL / _TERMS_URL.
  // Until then the buttons surface a "coming soon" message.
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL ?? null;
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL ?? null;

  // Bug report, opens the user's email client with a structured,
  // pre-filled message to the support inbox. Auto-fills app version,
  // platform, and the chronicler's email so we can locate their account
  // and reproduce on the same build. Zero backend; just leverages mailto:.
  //
  // Future upgrade path: replace mailto with an in-app form that posts
  // to a Supabase bug_reports table + sends a Resend notification, gives
  // structured data and removes the dependency on the user having a mail
  // client configured. For v1 closed-alpha this simpler path is enough.
  const onReportBug = async () => {
    const version = Constants.expoConfig?.version ?? 'unknown';
    const subject = `Questline bug report (v${version})`;
    const body = [
      'Tell us what happened, in the chronicler\'s own words:',
      '',
      '',
      '',
      'What were you expecting?',
      '',
      '',
      '',
      'Steps to reproduce (if you can):',
      '1. ',
      '2. ',
      '3. ',
      '',
      '----------------------------------',
      'Do not edit below this line, the Archivist needs it for the audit:',
      `App version: ${version}`,
      `Platform:    ${Platform.OS} ${Platform.Version}`,
      `Account:     ${session?.user.email ?? 'unknown'}`,
    ].join('\n');
    const url = `mailto:questline.customerservice@gmail.com?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        await showInfoMessage(
          'No mail app found',
          'Could not open an email client on this device. Send your report to questline.customerservice@gmail.com directly.',
        );
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      console.warn('[settings] bug report mailto failed', e);
      await showInfoMessage(
        'Could not open mail',
        'Send your report to questline.customerservice@gmail.com directly.',
      );
    }
  };

  const onOpenLegal = async (url: string | null, label: string) => {
    if (!url) {
      await showInfoMessage(
        `${label} forthcoming`,
        `${label} is being prepared by the scribes. It will be hosted at a public URL before the App Store gates open.`,
      );
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      console.warn('legal browser open failed', e);
    }
  };

  const onExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await shareChronicle();
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const onSendEmailChange = async () => {
    setEmailError(null);
    setEmailBusy(true);
    try {
      await requestEmailChange(newEmail);
      await showInfoMessage(
        'Confirmation sent',
        `Check ${newEmail.trim()} for a confirmation link. Your account email changes once you click through.`,
      );
      setEmailEditing(false);
      setNewEmail('');
    } catch (e) {
      setEmailError(errorMessage(e));
    } finally {
      setEmailBusy(false);
    }
  };

  const onDeleteAccount = async () => {
    const proceed = await confirmDestructive(
      'Delete your chronicle?',
      'Every quest, faction, campaign, and entry the Tome holds for you will be erased. This cannot be undone.',
    );
    if (!proceed) return;
    // Two-step confirm, irreversible action deserves it.
    const reallyProceed = await confirmDestructive(
      'Truly?',
      'Type-confirm dialogs aren\'t available here, but consider this your final ward. Continue and the Tome closes on you forever.',
    );
    if (!reallyProceed) return;

    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await deleteAccount();
      // Server-side delete succeeded; sign out to clear the now-invalid
      // local session and bounce back to (auth).
      await signOut();
    } catch (e) {
      setDeleteError(errorMessage(e));
      setDeleteBusy(false);
    }
  };

  const onTapReset = async () => {
    const proceed = await confirmDestructive(
      'Reset your chronicle?',
      'Every quest, faction, campaign, and entry the Tome holds for you will be erased. Your account and login remain, but you will return to the chronicle\'s forging and start anew. This cannot be undone.',
    );
    if (!proceed) return;
    setResetTypeInput('');
    setResetError(null);
    setResetStage('confirming');
  };

  const onCancelReset = () => {
    setResetStage('idle');
    setResetTypeInput('');
    setResetError(null);
  };

  const onConfirmReset = async () => {
    if (resetTypeInput !== 'DELETE') return;
    setResetBusy(true);
    setResetError(null);
    try {
      await resetCharacter();
      // Wipe local artifacts so the fresh chronicle isn't haunted by the
      // previous one: cached quest lists, cinematic-seen flag, tutorial flag.
      await clearQuestCache();
      await resetTutorial();
      await resetCinematicSeen();
      // Refetching profile sets character_name back to null in auth state,
      // which trips useProtectedRoute and bounces us through onboarding.
      await refetchProfile();
    } catch (e) {
      setResetError(errorMessage(e));
      setResetBusy(false);
    }
  };

  const onSendPasswordReset = async () => {
    if (!session?.user.email) return;
    const proceed = await confirmDestructive(
      'Send reset email?',
      `A password-reset link will be sent to ${session.user.email}. Click through it to set a new password.`,
    );
    if (!proceed) return;
    setPasswordError(null);
    setPasswordBusy(true);
    try {
      await requestPasswordReset(session.user.email);
      // After-press confirmation, in voice. The pre-action confirm above
      // stays plain so the chronicler reads the consequence clearly before
      // committing; only the success bubble gets the lore treatment.
      await showInfoMessage(
        'The scroll is on its way',
        `The Archivist has dispatched it to ${session.user.email}. Look in your inbox, and the spam pile if the raven wandered.`,
      );
    } catch (e) {
      setPasswordError(errorMessage(e));
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
      <Text className="mb-6 font-display text-4xl text-stone-900">Settings</Text>

      {/* Account */}
      <SectionHeader id="account" title="Account">
      {session?.user.email ? (
        <View className="mb-3">
          <Text className="mb-1 font-display text-lg uppercase tracking-widest text-stone-500">
            Signed in as
          </Text>
          <Text className="font-body text-stone-800">{session.user.email}</Text>
        </View>
      ) : null}

      {emailEditing ? (
        <View className="mb-3 rounded-md border border-amber-900/50 bg-amber-50/40 p-3">
          <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
            New email address
          </Text>
          <TextInput
            value={newEmail}
            onChangeText={setNewEmail}
            placeholder="you@example.com"
            placeholderTextColor="#57534e"
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!emailBusy}
            className="mb-3 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
          />
          {emailError ? (
            <Text className="mb-2 font-body text-xl text-red-700">{emailError}</Text>
          ) : null}
          <View className="flex-row gap-2">
            <Pressable
              onPress={onSendEmailChange}
              disabled={emailBusy || !newEmail.trim()}
              className={`flex-1 rounded-md px-3 py-2 ${
                emailBusy || !newEmail.trim()
                  ? 'bg-amber-100/40'
                  : 'bg-amber-600 active:bg-amber-700'
              }`}
            >
              <Text className="text-center font-body-medium text-xl text-stone-900">
                {emailBusy ? 'Sending…' : 'Send confirmation'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setEmailEditing(false);
                setNewEmail('');
                setEmailError(null);
              }}
              disabled={emailBusy}
              className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
            >
              <Text className="font-body text-xl text-stone-700">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setEmailEditing(true)}
          className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-2xl text-stone-800">Change email</Text>
        </Pressable>
      )}

      <Pressable
        onPress={onSendPasswordReset}
        disabled={passwordBusy || !session?.user.email}
        className={`mb-3 rounded-md border border-stone-700 px-4 py-3 ${
          passwordBusy ? 'bg-amber-100/40' : 'bg-amber-50/40 active:bg-amber-100/60'
        }`}
      >
        <Text className="text-center font-body text-2xl text-stone-800">
          {passwordBusy ? 'Sending…' : 'Reset Password'}
        </Text>
      </Pressable>
      {passwordError ? (
        <Text className="mb-3 font-body text-xl text-red-700">{passwordError}</Text>
      ) : null}

      <Pressable
        onPress={() => signOut()}
        className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
      >
        <Text className="text-center font-body text-2xl text-stone-900">Sign out</Text>
      </Pressable>

      {/* Reset character, wipes the chronicle but keeps the auth account.
          Two-step gate: the in-voice confirm dialog opens an inline panel
          that requires literally typing DELETE before the action arms. */}
      {resetStage === 'idle' ? (
        <Pressable
          onPress={onTapReset}
          className="mb-3 rounded-md border border-amber-700/60 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-lg text-amber-800">
            Reset character
          </Text>
        </Pressable>
      ) : (
        <View className="mb-3 rounded-md border border-amber-700/60 bg-amber-50/40 px-4 py-3">
          <Text className="mb-2 font-body text-lg text-stone-800">
            Type{' '}
            <Text className="font-body-medium text-amber-900">DELETE</Text>
            {' '}to confirm. The Tome will be wiped clean and the chronicle
            forged anew. Your account remains.
          </Text>
          <TextInput
            value={resetTypeInput}
            onChangeText={setResetTypeInput}
            placeholder="DELETE"
            placeholderTextColor="#a8a29e"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!resetBusy}
            className="mb-3 rounded-md border border-stone-700 bg-amber-100/40 px-3 py-2 font-body text-stone-900"
          />
          <View className="flex-row gap-2">
            <Pressable
              onPress={onConfirmReset}
              disabled={resetBusy || resetTypeInput !== 'DELETE'}
              className={`flex-1 rounded-md px-3 py-2 ${
                resetBusy || resetTypeInput !== 'DELETE'
                  ? 'bg-amber-100/40'
                  : 'bg-red-700 active:bg-red-800'
              }`}
            >
              <Text
                className={`text-center font-body-medium text-base ${
                  resetBusy || resetTypeInput !== 'DELETE'
                    ? 'text-stone-500'
                    : 'text-amber-50'
                }`}
              >
                {resetBusy ? 'Erasing the Tome…' : 'Reset chronicle'}
              </Text>
            </Pressable>
            <Pressable
              onPress={onCancelReset}
              disabled={resetBusy}
              className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
            >
              <Text className="text-center font-body-medium text-base text-stone-700">
                Cancel
              </Text>
            </Pressable>
          </View>
          {resetError ? (
            <Text className="mt-3 font-body text-base text-red-700">{resetError}</Text>
          ) : null}
        </View>
      )}

      <Pressable
        onPress={onDeleteAccount}
        disabled={deleteBusy}
        className={`mb-3 rounded-md border border-red-900/60 px-4 py-3 ${
          deleteBusy ? 'bg-red-100/40' : 'bg-red-50/40 active:bg-red-100/60'
        }`}
      >
        <Text className="text-center font-body text-lg text-red-700">
          {deleteBusy ? 'Closing the Tome…' : 'Delete account'}
        </Text>
      </Pressable>
      {deleteError ? (
        <Text className="mb-3 font-body text-base text-red-700">{deleteError}</Text>
      ) : null}
      </SectionHeader>

      {/* Chronicle */}
      <SectionHeader id="chronicle" title="Chronicle">
      <Pressable
        onPress={onExport}
        disabled={exporting}
        className={`mb-3 rounded-md border border-stone-700 px-4 py-3 ${
          exporting ? 'bg-amber-100/40' : 'bg-amber-50/40 active:bg-amber-100/60'
        }`}
      >
        <Text className="text-center font-body text-2xl text-stone-800">
          {exporting ? 'The scribes are at work…' : 'Transcribe the Tome'}
        </Text>
      </Pressable>
      <Text className="-mt-1 mb-3 font-body text-lg text-stone-500">
        Take a written copy of your chronicle, character, factions, campaigns,
        and every quest the Tome remembers.
      </Text>
      {exportError ? (
        <Text className="mb-3 font-body text-xl text-red-700">{exportError}</Text>
      ) : null}

      <Pressable
        onPress={() => router.push('/cinematic')}
        className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
      >
        <Text className="text-center font-body text-2xl text-stone-800">
          Replay opening cinematic
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          // Provider's onStart routes to /quest-board so the spotlight has
          // its first target on screen.
          void tutorial.start();
        }}
        className="mb-8 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
      >
        <Text className="text-center font-body text-2xl text-stone-800">
          Replay orientation
        </Text>
      </Pressable>
      </SectionHeader>

      {/* Subscription */}
      <SectionHeader id="subscription" title="Subscription">
      <View
        className={`mb-3 rounded-md border px-4 py-3 ${
          subscription?.tier === 'hero'
            ? 'border-amber-700/60 bg-amber-900/30'
            : 'border-stone-700 bg-amber-50/40'
        }`}
      >
        <Text
          className={`font-display text-lg uppercase tracking-widest ${
            subscription?.tier === 'hero' ? 'text-amber-800' : 'text-stone-700'
          }`}
        >
          {subscription?.tier === 'hero' ? 'Hero · pledged to the Archivist' : 'Free chronicler'}
        </Text>
        <Text className="mt-1 font-body text-xl text-stone-700">
          {subscription?.tier === 'hero'
            ? 'No cap on active quests. The Tome opens fully.'
            : `Up to ${FREE_TIER_QUEST_CAP} active quests at once.`}
        </Text>
      </View>
      {subscription?.tier === 'free' ? (
        <Pressable
          onPress={() => router.push('/paywall')}
          className="mb-8 rounded-md border border-amber-700/60 bg-amber-100/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-xl text-amber-800">
            Pledge your oath to the Archivist
          </Text>
          <Text className="mt-1 text-center font-body text-base text-stone-600">
            Lifetime · Yearly · Monthly. Tap to read the offer.
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => router.push('/customer-center')}
          className="mb-8 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-xl text-stone-800">
            Manage subscription
          </Text>
          <Text className="mt-1 text-center font-body text-base text-stone-600">
            View, restore, or cancel your pledge.
          </Text>
        </Pressable>
      )}
      </SectionHeader>

      {/* Notifications */}
      <SectionHeader id="notifications" title="Notifications">
      {permissionStatus === 'unsupported' ? (
        <View className="mb-3 rounded-md border border-stone-800 bg-amber-50/40 px-4 py-3">
          <Text className="font-body text-xl text-stone-700">
            Local notifications aren&apos;t available on this platform. Open Questline on iOS or
            Android to schedule deadline reminders and the daily check-in.
          </Text>
        </View>
      ) : permissionStatus !== 'granted' ? (
        <Pressable
          onPress={onRequestPermission}
          disabled={notifBusy}
          className={`mb-3 rounded-md border border-stone-700 px-4 py-3 ${
            notifBusy ? 'bg-amber-100/40' : 'bg-amber-50/40 active:bg-amber-100/60'
          }`}
        >
          <Text className="text-center font-body text-2xl text-stone-800">
            {notifBusy
              ? 'Asking the device…'
              : permissionStatus === 'denied'
                ? 'Permission denied, open device Settings to re-enable'
                : 'Allow notifications'}
          </Text>
        </Pressable>
      ) : (
        <>
          <View className="mb-3 rounded-md border border-stone-800 bg-amber-50/40 px-4 py-3">
            <Text className="font-body text-xl text-stone-700">
              Deadline reminders are scheduled automatically when you set a deadline (24h and 1h
              before).
            </Text>
          </View>
          <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
            Check-in cadence
          </Text>
          <DropdownPicker
            label=""
            value={cadence}
            onChange={onCadenceChange}
            options={CADENCE_OPTIONS}
            disabled={notifBusy}
          />

          {cadence !== 'off' ? (
            <>
              <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
                Time
              </Text>
              <View className="mb-4 flex-row gap-3">
                <View className="flex-1">
                  <DropdownPicker
                    label=""
                    value={hour}
                    onChange={onHourChange}
                    options={HOUR_OPTIONS}
                    disabled={notifBusy}
                  />
                </View>
                <View className="flex-1">
                  <DropdownPicker
                    label=""
                    value={minute}
                    onChange={onMinuteChange}
                    options={MINUTE_OPTIONS}
                    disabled={notifBusy}
                  />
                </View>
              </View>
            </>
          ) : null}

          {cadence === 'weekly' ? (
            <>
              <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
                Day of the week
              </Text>
              <DropdownPicker
                label=""
                value={String(weekday)}
                onChange={onWeekdayChange}
                options={WEEKDAY_OPTIONS}
                disabled={notifBusy}
              />
            </>
          ) : null}

          {cadence === 'custom' ? (
            <View className="mb-8">
              <Text className="mb-2 font-display text-base uppercase tracking-widest text-stone-500">
                Days
              </Text>
              <View className="flex-row gap-2">
                {DAY_CHIPS.map((chip) => {
                  const selected = days.includes(chip.day);
                  return (
                    <Pressable
                      key={chip.day}
                      onPress={() => toggleDay(chip.day)}
                      disabled={notifBusy}
                      className={`h-10 w-10 items-center justify-center rounded-full border ${
                        selected
                          ? 'border-amber-500 bg-amber-600/20'
                          : 'border-stone-700 bg-amber-50/40'
                      }`}
                    >
                      <Text
                        className={`font-body-medium text-lg ${
                          selected ? 'text-amber-800' : 'text-stone-700'
                        }`}
                      >
                        {chip.short}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {days.length === 0 ? (
                <Text className="mt-2 font-body text-sm italic text-amber-700">
                  Pick at least one day, or the check-in will run every day.
                </Text>
              ) : null}
            </View>
          ) : (
            <View className="mb-8" />
          )}
        </>
      )}
      </SectionHeader>

      {/* Audio */}
      <SectionHeader id="audio" title="Audio">
      <Pressable
        onPress={() => void setMuted(!muted)}
        className="mb-3 flex-row items-center justify-between rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
      >
        <View className="flex-1 pr-3">
          <Text className="font-body text-2xl text-stone-800">Mute all audio</Text>
          <Text className="mt-0.5 font-body text-lg text-stone-500">
            Silences the cinematic, ambient bed, and UI sound effects. Settings is the only screen
            that still chimes on toggle.
          </Text>
        </View>
        <View
          className={`h-6 w-11 rounded-full ${muted ? 'bg-amber-600' : 'bg-stone-700'} justify-center`}
        >
          <View
            className={`h-5 w-5 rounded-full bg-stone-100 ${muted ? 'self-end mr-0.5' : 'self-start ml-0.5'}`}
          />
        </View>
      </Pressable>
      </SectionHeader>

      {/* Appearance: System / Light / Midnight Chronicle. The chronicler's
          choice is persisted across launches; 'System' tracks the OS dark
          mode toggle live. */}
      <SectionHeader id="appearance" title="Appearance">
        <AppearancePicker />
      </SectionHeader>

      {/* Help & feedback. Bug report opens the user's mail client with a
          structured, pre-filled report addressed to the support inbox. */}
      <SectionHeader id="help" title="Help & Feedback">
        <Pressable
          onPress={onReportBug}
          className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-lg text-stone-800">Report a bug</Text>
        </Pressable>
        <Text className="mb-2 px-2 font-body text-sm italic text-stone-500">
          Opens your mail app with a pre-filled report. The Archivist reads every dispatch.
        </Text>
      </SectionHeader>

      {/* Legal */}
      <SectionHeader id="legal" title="Legal">
        <Pressable
          onPress={() => onOpenLegal(privacyUrl, 'Privacy policy')}
          className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-lg text-stone-800">Privacy policy</Text>
        </Pressable>
        <Pressable
          onPress={() => onOpenLegal(termsUrl, 'Terms of service')}
          className="mb-2 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-lg text-stone-800">Terms of service</Text>
        </Pressable>
      </SectionHeader>
      </ScrollView>
    </ParchmentScreen>
  );
}

/** Three-option picker for the chronicler's color-mode preference. System
 *  follows the OS toggle live; Light forces the parchment-by-sunlight look;
 *  Dark is the Midnight Chronicle palette. */
function AppearancePicker() {
  const { preference, setPreference } = useColorMode();
  const options: { value: ColorModePreference; label: string; hint: string }[] = [
    {
      value: 'system',
      label: 'System',
      hint: 'Follows your device’s light/dark setting.',
    },
    {
      value: 'light',
      label: 'Light',
      hint: 'Parchment by sunlight. The Archivist’s default look.',
    },
    {
      value: 'dark',
      label: 'Midnight Chronicle',
      hint: 'Dark vellum, candle-warm accents. Easier on the eyes after dusk.',
    },
  ];
  return (
    <View className="gap-2">
      {options.map((opt) => {
        const selected = preference === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => void setPreference(opt.value)}
            className={`rounded-md border px-4 py-3 ${
              selected
                ? 'border-amber-700 bg-amber-100/60'
                : 'border-stone-700 bg-amber-50/40 active:bg-amber-100/60'
            }`}
          >
            <View className="flex-row items-center justify-between">
              <Text className="font-body-medium text-xl text-stone-900">{opt.label}</Text>
              {selected ? (
                <Text className="font-display text-base text-amber-800">✓</Text>
              ) : null}
            </View>
            <Text className="mt-0.5 font-body text-sm text-stone-500">{opt.hint}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Settings section wrapper: title row + collapsible content. Restyled from
// the old presentational-only SectionHeader so each category gets an arrow
// chevron and persists its collapsed state across launches. id is stable
// per section so AsyncStorage keeps the chronicler's preference.
function SectionHeader({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <CollapsibleSection id={`settings-${id}`} title={title} className="mb-8">
      {children}
    </CollapsibleSection>
  );
}
