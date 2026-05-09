// First-launch orientation. Mounted once at the (main) layout root,
// renders as a full-screen overlay if the user hasn't seen it yet.
// Five short steps in the Archivist's voice, each dismissible. The
// "Skip" link advances straight to "seen" without forcing the user
// through every screen.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { hasSeenTutorial, markTutorialSeen } from '../lib/tutorial';

interface Step {
  eyebrow: string;
  title: string;
  body: string;
  /** Label for the advance button on this step. Last step uses "Begin". */
  nextLabel: string;
}

const STEPS: Step[] = [
  {
    eyebrow: 'The Tome opens',
    title: 'Welcome, chronicler',
    body: "I am the Archivist of Fate. Your endeavors will be inscribed here, day by day. A brief orientation, before the first quill stroke.",
    nextLabel: 'Continue',
  },
  {
    eyebrow: 'The Quest Board',
    title: 'Forge your endeavors',
    body: "Each task you mean to undertake becomes a quest. Tap + New to describe what you need to do — the Tome will give it shape, a tier, and a buff you might earn for finishing well.",
    nextLabel: 'Continue',
  },
  {
    eyebrow: 'The Character Sheet',
    title: 'Your standing in the chronicle',
    body: "Your level, factions, campaigns, and any active modifiers live on the Character tab. Modifiers are buffs you've earned and debuffs the Tome has noted — both fade in time.",
    nextLabel: 'Continue',
  },
  {
    eyebrow: 'Recurring deeds',
    title: 'Daily and weekly quests',
    body: "Quests can recur. A daily quest resets each morning; a weekly one each week. Completing them in succession builds streaks, and the Tome rewards persistence.",
    nextLabel: 'Continue',
  },
  {
    eyebrow: 'Settings',
    title: 'When the time comes',
    body: "Audio, notifications, your chronicle export, and — should you wish — your pledge to the Archivist all live in Settings. The Tome serves at your pace.",
    nextLabel: 'Begin',
  },
];

export function TutorialOverlay() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void hasSeenTutorial().then((seen) => {
      if (!cancelled) setVisible(!seen);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onNext = async () => {
    if (step + 1 < STEPS.length) {
      setStep(step + 1);
      return;
    }
    await markTutorialSeen();
    setVisible(false);
  };

  const onSkip = async () => {
    await markTutorialSeen();
    setVisible(false);
  };

  if (!visible) return null;

  // STEPS is constant, length validated above; the index is always in range.
  const current = STEPS[step] as Step;

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      exiting={FadeOut.duration(250)}
      style={[StyleSheet.absoluteFillObject, styles.scrim]}
    >
      <View style={styles.cardWrap}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{current.eyebrow}</Text>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>

          <View style={styles.dotsRow}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === step ? styles.dotActive : null]}
              />
            ))}
          </View>

          <Pressable onPress={onNext} style={styles.nextBtn}>
            <Text style={styles.nextLabel}>{current.nextLabel}</Text>
          </Pressable>

          {step + 1 < STEPS.length ? (
            <Pressable onPress={onSkip} style={styles.skipBtn}>
              <Text style={styles.skipLabel}>Skip the orientation</Text>
            </Pressable>
          ) : (
            <View style={{ height: 12 }} />
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// Inline StyleSheet rather than NativeWind here so the overlay always
// renders correctly even if the Tailwind context isn't in scope (it is,
// but absolute overlays in nested layouts have bitten us before).
const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(31, 26, 23, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 100,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 480,
  },
  card: {
    backgroundColor: '#f5e7c1',
    borderColor: '#92400e',
    borderWidth: 1,
    borderRadius: 6,
    padding: 28,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  eyebrow: {
    fontFamily: 'Cinzel_400Regular',
    fontSize: 13,
    letterSpacing: 3,
    color: '#92400e',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'Cinzel_700Bold',
    fontSize: 26,
    color: '#1f1a17',
    marginBottom: 16,
    lineHeight: 32,
  },
  body: {
    fontFamily: 'EBGaramond_400Regular',
    fontSize: 18,
    lineHeight: 28,
    color: '#1f1a17',
    marginBottom: 24,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(146, 64, 14, 0.25)',
  },
  dotActive: {
    backgroundColor: '#92400e',
    width: 18,
  },
  nextBtn: {
    backgroundColor: '#d97706',
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
  },
  nextLabel: {
    fontFamily: 'Cinzel_400Regular',
    fontSize: 18,
    color: '#fef3c7',
    letterSpacing: 1.5,
  },
  skipBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  skipLabel: {
    fontFamily: 'EBGaramond_400Regular',
    fontSize: 14,
    color: '#5a4a3a',
  },
});
