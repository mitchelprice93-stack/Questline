// First-launch spotlight tutorial. When active, the overlay either:
//   - draws a 4-rectangle scrim leaving a "hole" around a target rect
//     (registered by a <TutorialTarget> elsewhere in the tree), with a
//     tooltip card pointing at the hole, OR
//   - falls back to a centered modal card for steps that don't have a
//     specific UI element to highlight.
//
// Mounted once at the (main) layout root inside <TutorialProvider>.

import { useEffect, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { useTutorial, type TargetRect } from '../lib/tutorial-context';

interface Step {
  /** Centered modal when null. Otherwise the id of a TutorialTarget to spotlight. */
  targetId: string | null;
  eyebrow: string;
  title: string;
  body: string;
  nextLabel: string;
}

export const TUTORIAL_STEPS: Step[] = [
  {
    targetId: null,
    eyebrow: 'The Tome opens',
    title: 'Welcome, chronicler',
    body:
      "I am the Archivist of Fate. Your endeavors will be inscribed here, day by day. " +
      'A brief orientation, before the first quill stroke.',
    nextLabel: 'Continue',
  },
  {
    targetId: 'new-quest-button',
    eyebrow: 'The Quest Board',
    title: 'Forge a new endeavor',
    body:
      "Tap the + when you're ready to inscribe a new quest. Describe what you mean to do " +
      'in plain language; the Tome will give it shape, a tier, and a buff you might earn for finishing well.',
    nextLabel: 'Continue',
  },
  {
    targetId: 'quest-status-tabs',
    eyebrow: 'The Tome remembers',
    title: 'Active, completed, abandoned',
    body:
      'Every quest passes through these three states. Active is the work at hand; ' +
      "Completed is the work the Tome has inscribed; Abandoned is the work you've set aside.",
    nextLabel: 'Continue',
  },
  {
    targetId: 'tab-bar',
    eyebrow: 'Beneath the page',
    title: 'Your tabs',
    body:
      'The Quest Board sits beside your Character — your level, factions, campaigns, and any ' +
      'modifiers in play — and Settings, where audio, notifications, and your chronicle export live.',
    nextLabel: 'Continue',
  },
  {
    targetId: null,
    eyebrow: 'Begin',
    title: 'The Tome opens once more',
    body:
      'You may revisit this orientation at any time from Settings. ' +
      'Now — what shall we inscribe first?',
    nextLabel: 'Begin',
  },
];

// Tooltip dimensions used to decide whether it sits above or below the hole.
const TOOLTIP_MAX_WIDTH = 360;
const TOOLTIP_GAP = 16;

export function TutorialOverlay() {
  const { step, isActive, getTarget, next, skip } = useTutorial();
  const [screen, setScreen] = useState(() => Dimensions.get('window'));

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setScreen(window));
    return () => sub.remove();
  }, []);

  if (!isActive) return null;
  const current = TUTORIAL_STEPS[step];
  if (!current) return null;

  const target = current.targetId ? getTarget(current.targetId) : null;
  // Bare scrim until the target has reported its layout; avoids a "no hole"
  // flash that looks like a regular modal.
  const isLast = step + 1 >= TUTORIAL_STEPS.length;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFillObject, styles.layer]}
    >
      {target ? (
        <SpotlightScrim target={target} screen={screen} />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.fullScrim]} pointerEvents="auto" />
      )}
      <Tooltip
        target={target}
        screen={screen}
        eyebrow={current.eyebrow}
        title={current.title}
        body={current.body}
        nextLabel={current.nextLabel}
        showSkip={!isLast}
        onNext={next}
        onSkip={skip}
        stepIndex={step}
        totalSteps={TUTORIAL_STEPS.length}
      />
    </Animated.View>
  );
}

interface SpotlightScrimProps {
  target: TargetRect;
  screen: { width: number; height: number };
}

function SpotlightScrim({ target, screen }: SpotlightScrimProps) {
  // Target rects are now measured RELATIVE TO THE TUTORIAL ANCHOR (see
  // TutorialTarget and TabBarTutorialAnchor in (main)/_layout.tsx), which
  // is the same View the overlay sits inside. That means target.x/y are
  // already in the overlay's coordinate space — no mode-based shift, no
  // per-step override, no measurement compensation. Just symmetric padding
  // around the actual target rect. 2px keeps the hole tight against the
  // button edge; the glow ring (top: y - 2 in the JSX below) adds another
  // 2px outset so the total gap between the visible button and the glow
  // is 4px — present but unobtrusive.
  const padX = 2;
  const padY = 2;
  const x = Math.max(0, target.x - padX);
  const y = Math.max(0, target.y - padY);
  const w = Math.min(screen.width - x, target.width + padX * 2);
  const h = Math.min(screen.height - y, target.height + padY * 2);

  return (
    <>
      {/* Top */}
      <View style={[styles.scrimRect, { top: 0, left: 0, right: 0, height: y }]} />
      {/* Bottom */}
      <View
        style={[
          styles.scrimRect,
          { top: y + h, left: 0, right: 0, bottom: 0 },
        ]}
      />
      {/* Left */}
      <View style={[styles.scrimRect, { top: y, left: 0, width: x, height: h }]} />
      {/* Right */}
      <View
        style={[
          styles.scrimRect,
          { top: y, left: x + w, right: 0, height: h },
        ]}
      />
      {/* Transparent block over the hole — keeps the user from tapping
          the spotlit element while the tutorial is open. They use Next
          (or Skip) to dismiss; once dismissed they have full access. */}
      <View
        style={{ position: 'absolute', top: y, left: x, width: w, height: h }}
      />
      {/* Glow ring around the hole. */}
      <View
        pointerEvents="none"
        style={[
          styles.spotlightRing,
          { top: y - 2, left: x - 2, width: w + 4, height: h + 4 },
        ]}
      />
    </>
  );
}

interface TooltipProps {
  target: TargetRect | null;
  screen: { width: number; height: number };
  eyebrow: string;
  title: string;
  body: string;
  nextLabel: string;
  showSkip: boolean;
  onNext: () => void;
  onSkip: () => void;
  stepIndex: number;
  totalSteps: number;
}

function Tooltip({
  target,
  screen,
  eyebrow,
  title,
  body,
  nextLabel,
  showSkip,
  onNext,
  onSkip,
  stepIndex,
  totalSteps,
}: TooltipProps) {
  // Centered card when there's no target.
  if (!target) {
    return (
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, styles.centerWrap]}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <Dots count={totalSteps} active={stepIndex} />
          <Pressable onPress={onNext} style={styles.nextBtn}>
            <Text style={styles.nextLabel}>{nextLabel}</Text>
          </Pressable>
          {showSkip ? (
            <Pressable onPress={onSkip} style={styles.skipBtn}>
              <Text style={styles.skipLabel}>Skip the orientation</Text>
            </Pressable>
          ) : (
            <View style={{ height: 12 }} />
          )}
        </View>
      </View>
    );
  }

  // Decide whether the tooltip sits above or below the highlighted target.
  // Empirically the rendered card is ~360-400px tall depending on body
  // length (eyebrow + title + 3-4 body lines + dots + Next btn + optional
  // Skip btn + paddings). 380 covers the common case without leaving so
  // much slack that we falsely place-above when below would fit cleanly.
  const estimatedHeight = 380;
  const spaceBelow = screen.height - (target.y + target.height);
  const placeBelow = spaceBelow >= estimatedHeight + TOOLTIP_GAP * 2;

  const top = placeBelow
    ? target.y + target.height + TOOLTIP_GAP
    : Math.max(TOOLTIP_GAP, target.y - estimatedHeight - TOOLTIP_GAP);

  // Center horizontally on the target, clamped to the screen with margins.
  const margin = 16;
  const targetCenter = target.x + target.width / 2;
  const ttWidth = Math.min(TOOLTIP_MAX_WIDTH, screen.width - margin * 2);
  let left = targetCenter - ttWidth / 2;
  left = Math.max(margin, Math.min(screen.width - margin - ttWidth, left));

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFillObject]}
    >
      <View
        pointerEvents="auto"
        style={[styles.card, { position: 'absolute', top, left, width: ttWidth }]}
      >
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Dots count={totalSteps} active={stepIndex} />
        <Pressable onPress={onNext} style={styles.nextBtn}>
          <Text style={styles.nextLabel}>{nextLabel}</Text>
        </Pressable>
        {showSkip ? (
          <Pressable onPress={onSkip} style={styles.skipBtn}>
            <Text style={styles.skipLabel}>Skip the orientation</Text>
          </Pressable>
        ) : (
          <View style={{ height: 12 }} />
        )}
      </View>
    </View>
  );
}

function Dots({ count, active }: { count: number; active: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === active ? styles.dotActive : null]} />
      ))}
    </View>
  );
}

const SCRIM_COLOR = 'rgba(31, 26, 23, 0.78)';

const styles = StyleSheet.create({
  layer: {
    zIndex: 100,
  },
  fullScrim: {
    backgroundColor: SCRIM_COLOR,
  },
  scrimRect: {
    position: 'absolute',
    backgroundColor: SCRIM_COLOR,
  },
  spotlightRing: {
    position: 'absolute',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fcd34d',
    shadowColor: '#fcd34d',
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  centerWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#f5e7c1',
    borderColor: '#92400e',
    borderWidth: 1,
    borderRadius: 6,
    padding: 24,
    maxWidth: 480,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  eyebrow: {
    fontFamily: 'Cinzel_400Regular',
    fontSize: 12,
    letterSpacing: 3,
    color: '#92400e',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    fontFamily: 'Cinzel_700Bold',
    fontSize: 22,
    color: '#1f1a17',
    marginBottom: 12,
    lineHeight: 28,
  },
  body: {
    fontFamily: 'EBGaramond_400Regular',
    fontSize: 16,
    lineHeight: 24,
    color: '#1f1a17',
    marginBottom: 18,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
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
    paddingVertical: 12,
    alignItems: 'center',
  },
  nextLabel: {
    fontFamily: 'Cinzel_400Regular',
    fontSize: 16,
    color: '#fef3c7',
    letterSpacing: 1.5,
  },
  skipBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  skipLabel: {
    fontFamily: 'EBGaramond_400Regular',
    fontSize: 13,
    color: '#5a4a3a',
  },
});
