// "Personal" achievement reveal popup. Fires the first time a campaign
// crosses 100%. Same parchment-unfurl animation as QuestCompleteScroll so
// the reveal feels of-a-piece with the other in-game moments.
//
// The Archivist generates the title + description; this card is pure
// presentation. Parent awaits onDismiss to chain into whatever should
// happen next (refresh, navigate, etc).

import { useEffect } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export interface CampaignAchievementData {
  /** AI-generated title, 2-5 words, Title Case. */
  title: string;
  /** AI-generated single-sentence description. */
  description: string;
  /** ISO timestamp this was earned. Formatted compactly in the card. */
  earnedAt: string;
  /** The arc_name of the campaign that produced the achievement. Shown
   *  in muted type below the title so the user knows which arc earned it. */
  campaignName: string;
}

interface Props {
  data: CampaignAchievementData | null;
  onDismiss: () => void;
}

function formatEarnedDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function CampaignAchievementScroll({ data, onDismiss }: Props) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (data) {
      scale.value = withTiming(1, {
        duration: 480,
        easing: Easing.out(Easing.back(0.7)),
      });
      opacity.value = withTiming(1, { duration: 240 });
    }
  }, [data, scale, opacity]);

  const close = () => {
    opacity.value = withTiming(0, { duration: 180 });
    scale.value = withTiming(
      0,
      { duration: 280, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDismiss)();
      },
    );
  };

  const scrollStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }],
    opacity: opacity.value,
  }));

  if (!data) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable
        onPress={close}
        className="flex-1 items-center justify-center bg-stone-950/70 px-6"
      >
        {/* Inner Pressable swallows taps on the card so only the backdrop
            or the explicit button dismiss. */}
        <Pressable onPress={() => undefined}>
          <Animated.View
            style={scrollStyle}
            className="w-full max-w-md rounded-md border-2 border-amber-900 bg-amber-50 p-6"
          >
            {/* Eyebrow + section heading */}
            <Text className="mb-1 text-center font-display text-xs uppercase tracking-[0.4em] text-amber-800">
              The Tome inscribes
            </Text>
            <Text className="mb-4 text-center font-display text-3xl text-stone-900">
              Achievement Unlocked
            </Text>

            {/* Achievement centerpiece. The Archivist's title varies from 2
                words ("The Founding") up to 5 words; on narrow phones (mom's
                phone, ~360dp) a long title at text-3xl can overflow the
                bubble. numberOfLines + adjustsFontSizeToFit lets the title
                use up to two lines and shrink down to ~60% of the base size
                before truncating, so it always fits cleanly without ellipsis. */}
            <View className="mb-3 items-center">
              <Text
                className="text-center font-display-bold text-3xl text-amber-700"
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {data.title}
              </Text>
              <Text
                className="mt-1 text-center font-body italic text-base text-stone-600"
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                for {data.campaignName}
              </Text>
            </View>

            {/* Description. The Archivist is told to stay under 25 words so
                it wraps gracefully. Capped at 6 lines as belt-and-suspenders;
                ellipsis only triggers if a future prompt drift produces an
                outlier-long paragraph. */}
            <Text
              className="mb-3 text-center font-body text-lg leading-6 text-stone-800"
              numberOfLines={6}
            >
              {data.description}
            </Text>

            {/* Earned date */}
            <Text
              className="mb-1 text-center font-body text-sm uppercase tracking-widest text-amber-800"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              Inscribed {formatEarnedDate(data.earnedAt)}
            </Text>

            {/* Dismiss button */}
            <Pressable
              onPress={close}
              className="mt-5 rounded-md bg-amber-700 px-4 py-3 active:bg-amber-800"
            >
              <Text className="text-center font-display text-xl text-amber-50">
                Onward
              </Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
