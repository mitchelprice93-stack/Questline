// Mounted once at the (main) layout root. Subscribes to the achievement
// feed and routes each newly-earned event to the right surface — toast for
// common/uncommon/rare, cinematic for legendary. Maintains a queue so a
// burst of grants from a single quest completion plays out in sequence
// rather than stacking on top of each other.

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { subscribe, type EarnedAchievement } from '../lib/achievement-feed';
import { AchievementCinematic } from './AchievementCinematic';
import { AchievementToast } from './AchievementToast';

export function AchievementSurface() {
  const [queue, setQueue] = useState<EarnedAchievement[]>([]);
  // The two surfaces are mutually exclusive: cinematic blocks the queue
  // until dismissed; toast auto-dismisses after AUTO_DISMISS_MS.
  const [currentToast, setCurrentToast] = useState<EarnedAchievement | null>(null);
  const [currentLegend, setCurrentLegend] = useState<EarnedAchievement | null>(null);

  // Listener: append every batch onto the queue.
  useEffect(() => {
    const unsub = subscribe((events) => {
      setQueue((prev) => [...prev, ...events]);
    });
    return unsub;
  }, []);

  // Pump: whenever there's something queued and no surface is busy, take
  // the next item and show the right surface.
  useEffect(() => {
    if (currentToast || currentLegend) return;
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    if (!next) return;
    setQueue(rest);
    if (next.achievement.tier === 'legendary') {
      setCurrentLegend(next);
    } else {
      setCurrentToast(next);
    }
  }, [queue, currentToast, currentLegend]);

  return (
    <>
      {/* Toast layer sits at the top edge; box-none so the rest of the UI
          stays interactive while the toast hangs out. */}
      <View style={styles.toastLayer} pointerEvents="box-none">
        {currentToast ? (
          <AchievementToast
            key={currentToast.achievement.code + currentToast.earnedAt}
            earned={currentToast}
            onDismiss={() => setCurrentToast(null)}
          />
        ) : null}
      </View>
      {/* Cinematic layer is full-screen and blocks taps — that's the point.
          Mounted only when there's a legendary in flight. */}
      {currentLegend ? (
        <View style={styles.cinematicLayer} pointerEvents="auto">
          <AchievementCinematic
            key={currentLegend.achievement.code + currentLegend.earnedAt}
            earned={currentLegend}
            onContinue={() => setCurrentLegend(null)}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toastLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 80,
  },
  cinematicLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 90,
  },
});
