import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { deleteAccount, requestEmailChange, requestPasswordReset } from '../../lib/account';
import { useAuth } from '../../lib/auth';
import { useAudioMuted } from '../../lib/audio-prefs';
import { shareChronicle } from '../../lib/chronicle';
import { confirmDestructive, showInfoMessage } from '../../lib/dialogs';
import { errorMessage } from '../../lib/errors';
import { ParchmentScreen } from '../../lib/parchment';
import { FREE_TIER_QUEST_CAP } from '../../lib/subscription';
import { useTutorial } from '../../lib/tutorial-context';
import {
  getCheckInTime,
  getPermissionStatus,
  requestPermission,
  setCheckInTime,
  type PermissionStatus,
} from '../../lib/notifications';

const CHECK_IN_OPTIONS: { key: 'off' | string; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: '07:00', label: '7 AM' },
  { key: '08:00', label: '8 AM' },
  { key: '09:00', label: '9 AM' },
  { key: '20:00', label: '8 PM' },
];

export default function Settings() {
  const { session, signOut, subscription } = useAuth();
  const router = useRouter();
  const tutorial = useTutorial();

  const [muted, setMuted] = useAudioMuted();

  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null);
  const [checkInTime, setCheckInTimeState] = useState<string>('off');
  const [notifBusy, setNotifBusy] = useState(false);

  useEffect(() => {
    void getPermissionStatus().then(setPermissionStatus);
    void getCheckInTime().then(setCheckInTimeState);
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

  const onSelectCheckIn = async (next: 'off' | string) => {
    setNotifBusy(true);
    try {
      await setCheckInTime(next);
      setCheckInTimeState(next);
    } catch (e) {
      console.warn('check-in schedule failed', e);
    } finally {
      setNotifBusy(false);
    }
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

  // Public URLs for the privacy policy and terms of service. Once those
  // pages are hosted (GitHub Pages, Notion, Termly — your call), drop the
  // URLs into .env.local under EXPO_PUBLIC_PRIVACY_URL / _TERMS_URL.
  // Until then the buttons surface a "coming soon" message.
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL ?? null;
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL ?? null;

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
    // Two-step confirm — irreversible action deserves it.
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
      await showInfoMessage(
        'Reset email sent',
        `Check ${session.user.email} for the link.`,
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
      <SectionHeader>Account</SectionHeader>
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
          {passwordBusy ? 'Sending…' : 'Send password reset email'}
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
      <View className="mb-8" />

      {/* Chronicle */}
      <SectionHeader>Chronicle</SectionHeader>
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
        Take a written copy of your chronicle — character, factions, campaigns,
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

      {/* Subscription */}
      <SectionHeader>Subscription</SectionHeader>
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

      {/* Notifications */}
      <SectionHeader>Notifications</SectionHeader>
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
                ? 'Permission denied — open device Settings to re-enable'
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
            Daily check-in
          </Text>
          <View className="mb-8 flex-row flex-wrap gap-2">
            {CHECK_IN_OPTIONS.map((opt) => {
              const selected = checkInTime === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => void onSelectCheckIn(opt.key)}
                  disabled={notifBusy}
                  className={`rounded-full border px-3 py-1.5 ${
                    selected
                      ? 'border-amber-500 bg-amber-600/20'
                      : 'border-stone-700 bg-amber-50/40'
                  }`}
                >
                  <Text
                    className={`font-body-medium text-xl ${
                      selected ? 'text-amber-800' : 'text-stone-700'
                    }`}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* Audio */}
      <SectionHeader>Audio</SectionHeader>
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

      {/* Legal */}
      <View className="mt-8">
        <SectionHeader>Legal</SectionHeader>
        <Pressable
          onPress={() => onOpenLegal(privacyUrl, 'Privacy policy')}
          className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-lg text-stone-800">Privacy policy</Text>
        </Pressable>
        <Pressable
          onPress={() => onOpenLegal(termsUrl, 'Terms of service')}
          className="mb-8 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-lg text-stone-800">Terms of service</Text>
        </Pressable>
      </View>
      </ScrollView>
    </ParchmentScreen>
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <Text className="mb-3 font-display text-lg uppercase tracking-[0.3em] text-amber-800">
      {children}
    </Text>
  );
}
