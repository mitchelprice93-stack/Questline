import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
// ScrollView from gesture-handler, not react-native. RN's ScrollView gets
// its responder stuck after a Modal dismiss on Android, eating the next
// tap as a potential scroll. See app/(main)/quest-board/[id].tsx for the
// full note.
import { ScrollView, Pressable as GHPressable } from 'react-native-gesture-handler';
import Animated, { Easing, withTiming } from 'react-native-reanimated';

import { DeadlinePicker } from '../../../components/deadline-picker';
import { DropdownPicker } from '../../../components/dropdown-picker';
import { parseDeadline } from '../../../lib/dates';
import { xpForTier, type QuestTier } from '../../../lib/engine/xp';
import { errorMessage } from '../../../lib/errors';
import {
  getPermissionStatus,
  hasShownAutoPrompt,
  markAutoPromptShown,
  requestPermission,
} from '../../../lib/notifications';
import { ParchmentScreen } from '../../../lib/parchment';
import { generateQuest, type GeneratedQuest } from '../../../lib/quest-generation';
import { createQuest } from '../../../lib/quests';
import { playSfx, startLoopSfx, stopLoopSfx } from '../../../lib/sfx';
import { isQuestCapError, questCapMessage } from '../../../lib/subscription';
import type {
  QuestClassification,
  QuestObjective,
  QuestRecurrence,
} from '../../../lib/types/models';
import {
  BuffEditor,
  buffDraftToPayload,
  emptyBuffDraft,
  type BuffDraft,
} from './_buff-editor';
import { CampaignPicker } from './_campaign-picker';
import { FactionPicker } from './_faction-picker';
import { ObjectivesEditor } from './_objectives-editor';
import { MonthDayChips, WeekdayChips } from './_recurrence-day-chips';

const TIERS: QuestTier[] = ['trivial', 'minor', 'standard', 'major', 'legendary'];
const CLASSIFICATIONS: QuestClassification[] = ['daily', 'side', 'main', 'legendary'];
type RecurrenceChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
const RECURRENCES: RecurrenceChoice[] = ['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];

const RECURRENCE_LABELS: Record<RecurrenceChoice, string> = {
  none: 'One-time',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  custom: 'Custom',
};
const RECURRENCE_DESCRIPTIONS: Record<RecurrenceChoice, string> = {
  none: 'Completes once and goes to the log.',
  daily: 'Resets each day. Consecutive completions build a streak.',
  weekly: 'Resets each week. Consecutive completions build a streak.',
  monthly: 'Resets each month. Consecutive completions build a streak.',
  yearly: 'Resets each year. Consecutive completions build a streak.',
  custom: 'Repeats on the cadence you choose below.',
};

type RecurrenceUnit = 'days' | 'weeks' | 'months';
const RECURRENCE_UNITS: RecurrenceUnit[] = ['days', 'weeks', 'months'];
const RECURRENCE_UNIT_LABELS: Record<RecurrenceUnit, string> = {
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
};

const CLASSIFICATION_DESCRIPTIONS: Record<QuestClassification, string> = {
  daily: 'Routine work, done in minutes.',
  side: 'A standalone thread, away from the main path.',
  main: 'Important work that drives the chronicle.',
  legendary: 'A magnum opus, multi-day or harder.',
};

function recurrenceForDb(choice: RecurrenceChoice): QuestRecurrence {
  return choice === 'none' ? null : choice;
}

// Tier-scaled default for campaign_contribution_pct. Mirrors the OLD
// trigger behavior so newly-linked campaigns feel familiar before the
// chronicler overrides the value.
function defaultPctForTier(t: QuestTier): number {
  switch (t) {
    case 'trivial':
      return 2;
    case 'minor':
      return 5;
    case 'standard':
      return 10;
    case 'major':
      return 20;
    case 'legendary':
      return 40;
  }
}

type Phase = 'input' | 'loading' | 'review';

// Parchment-unfurl entrance for the review screen, start collapsed
// (scaleY 0.05) + transparent, then ease open to full height while fading
// in. Reads like the Tome unrolling the page the Archivist just inscribed.
const ParchmentUnfurl = () => {
  'worklet';
  return {
    initialValues: {
      transform: [{ scaleY: 0.05 }],
      opacity: 0,
    },
    animations: {
      transform: [{ scaleY: withTiming(1, { duration: 550, easing: Easing.out(Easing.cubic) }) }],
      opacity: withTiming(1, { duration: 400 }),
    },
  };
};

export default function NewQuest() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('input');
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<GeneratedQuest | null>(null);
  const [tier, setTier] = useState<QuestTier>('standard');
  const [classification, setClassification] = useState<QuestClassification>('side');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [objectives, setObjectives] = useState<QuestObjective[]>([]);
  // Drag handles for objective rows are hidden until the user taps the
  // Reorder button next to the Objectives label. See [id].tsx for the
  // matching pattern on the edit screen.
  const [reorderingObjectives, setReorderingObjectives] = useState(false);
  // Deadline as an ISO timestamp (or null for none). On forge we run chrono
  // against the user's original prompt to seed it with any date they
  // mentioned ("by next Friday", "due April 15", etc). The DeadlinePicker
  // owns the calendar/time UI from there.
  const [deadlineIso, setDeadlineIso] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>('none');
  // Custom-cadence config, only meaningful when recurrence === 'custom'.
  // Defaults to "every 3 days" so the conditional UI doesn't appear empty
  // on first reveal.
  const [recurrenceInterval, setRecurrenceInterval] = useState<string>('3');
  const [recurrenceUnit, setRecurrenceUnit] = useState<RecurrenceUnit>('days');
  // Weekly pinned weekdays (0=Sun..6=Sat). Empty array = "once per week".
  // Monthly pinned days-of-month (1..31). Empty array = "once per month".
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([]);
  const [recurrenceMonthDays, setRecurrenceMonthDays] = useState<number[]>([]);
  const [buff, setBuff] = useState<BuffDraft>(emptyBuffDraft());
  const [campaignId, setCampaignId] = useState<string | null>(null);
  // % the campaign advances when this quest completes. Defaults via
  // tier-scaled fallback whenever a campaign is first linked; the user
  // can override on the review screen. String for the TextInput; we
  // parse + clamp at save time.
  const [campaignContributionPct, setCampaignContributionPct] = useState<string>('10');
  const [factionId, setFactionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onForge = async () => {
    if (!input.trim()) return;
    setPhase('loading');
    setError(null);
    // Looped quill scratch under the spinner, stops on response.
    startLoopSfx('quill_scratch');
    try {
      const generated = await generateQuest(input);
      stopLoopSfx('quill_scratch');
      setDraft(generated);
      setTitle(generated.title);
      setDescription(generated.description);
      setTier(generated.suggested_tier);
      setClassification(generated.classification);
      setObjectives(generated.objectives);
      // Seed the deadline from anything date-shaped in the original prompt.
      // chrono picks up phrases like "by next Friday", "due May 15", or a
      // bare "April 1". If nothing matches, the picker shows "No deadline"
      // and the chronicler can tap it to set one manually.
      const sniffed = parseDeadline(input);
      setDeadlineIso(sniffed ? sniffed.toISOString() : null);
      // Prefill the buff editor from the AI's design, user can tweak or
      // remove on review.
      setBuff({
        enabled: true,
        name: generated.granted_buff.name,
        description: generated.granted_buff.description,
        pct: String(generated.granted_buff.pct),
        condition: generated.granted_buff.condition,
      });
      // The Archivist may flag a campaign this endeavor advances. Already
      // validated against the active list in generateQuest, null when no
      // match. User can override in the picker.
      setCampaignId(generated.suggested_campaign_id);
      // Auto-default the campaign contribution % to the tier scale when
      // the AI links to a campaign. User can override on the review screen.
      if (generated.suggested_campaign_id) {
        setCampaignContributionPct(String(defaultPctForTier(generated.suggested_tier)));
      }
      setFactionId(generated.suggested_faction_id);
      // Apply the AI's recurrence inference. The AI never returns 'custom'
      // (too ambiguous to infer); the user picks that manually if they
      // want a specific interval.
      setRecurrence(generated.suggested_recurrence);
      setPhase('review');
    } catch (e) {
      stopLoopSfx('quill_scratch');
      playSfx('error');
      setError(e instanceof Error ? e.message : String(e));
      setPhase('input');
    }
  };

  const onRegenerate = () => {
    setDraft(null);
    onForge();
  };

  const onDiscard = () => {
    setDraft(null);
    setPhase('input');
  };

  const onSave = async () => {
    if (!draft) return;
    // Deadline comes from the DeadlinePicker as ISO already, no parsing.
    setSubmitting(true);
    setError(null);
    try {
      // Validate custom-cadence inputs before submit so the DB CHECK
      // constraint doesn't bounce us with a confusing error. NOTE: every
      // early-return MUST call setSubmitting(false), otherwise the button
      // stays disabled and the screen feels frozen.
      const parsedInterval =
        recurrence === 'custom' ? Math.max(1, Math.floor(Number(recurrenceInterval) || 0)) : null;
      if (recurrence === 'custom' && (!parsedInterval || parsedInterval < 1)) {
        playSfx('error');
        setError('Custom cadence needs a positive number for the interval.');
        setSubmitting(false);
        return;
      }
      // Validate + clamp campaign % when a campaign is linked. 0 is allowed
      // ("link this quest to the campaign but don't move the bar"); the DB
      // CHECK accepts 0..100 and the trigger no-ops on 0.
      let parsedPct: number | null = null;
      if (campaignId) {
        const raw = Math.floor(Number(campaignContributionPct) || 0);
        if (raw < 0 || raw > 100) {
          playSfx('error');
          setError('Campaign contribution must be between 0 and 100.');
          setSubmitting(false);
          return;
        }
        parsedPct = raw;
      }
      await createQuest({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        tier,
        classification,
        deadline: deadlineIso,
        recurrence: recurrenceForDb(recurrence),
        recurrenceInterval: parsedInterval,
        recurrenceUnit: recurrence === 'custom' ? recurrenceUnit : null,
        recurrenceWeekdays: recurrence === 'weekly' ? recurrenceWeekdays : null,
        recurrenceMonthDays: recurrence === 'monthly' ? recurrenceMonthDays : null,
        grantedBuff: buffDraftToPayload(buff),
        campaignId,
        campaignContributionPct: parsedPct,
        factionId,
        objectives: objectives
          .map((o) => ({ ...o, text: o.text.trim() }))
          .filter((o) => o.text.length > 0),
      });
      // The Tome inscribes a new entry, ceremonial scratch.
      playSfx('quest_create');
      // Auto-prompt for notification permission on the chronicler's FIRST
      // recurring quest, that's the moment notifications start being
      // useful (deadline reminders, recurrence streak nudges). Only ever
      // fires once per device; subsequent recurring quests don't re-prompt.
      // Decliners can re-enable from Settings. Fire-and-forget, the quest
      // already saved successfully, no reason to block on this UX bonus.
      if (recurrence !== 'none') {
        void (async () => {
          const shown = await hasShownAutoPrompt();
          if (shown) return;
          const status = await getPermissionStatus();
          // Only prompt when status is 'undetermined', if already granted
          // or denied, the OS sheet doesn't re-show.
          if (status === 'undetermined') {
            await requestPermission();
          }
          await markAutoPromptShown();
        })();
      }
      // router.back() is a no-op when there's no history (deep link or
      // browser refresh), without the canGoBack guard, the user is left
      // staring at a "Saving…" button while the quest already saved.
      if (router.canGoBack()) router.back();
      else router.replace('/quest-board');
    } catch (e) {
      playSfx('error');
      // Quest cap is a soft, recoverable rejection, show the in-voice
      // copy instead of the raw Postgres exception text.
      setError(isQuestCapError(e) ? questCapMessage() : errorMessage(e));
      setSubmitting(false);
    }
  };

  if (phase === 'loading') {
    return (
      <ParchmentScreen>
        <View className="flex-1 items-center justify-center px-6">
          <ActivityIndicator color="#92400e" size="large" />
          <Text className="mt-6 font-display text-xl text-stone-900">
            The Archivist considers your request…
          </Text>
        </View>
      </ParchmentScreen>
    );
  }

  if (phase === 'input') {
    return (
      <ParchmentScreen>
        <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
        <Text className="mb-1 font-display text-4xl text-stone-900">New endeavor</Text>
        <Text className="mb-6 font-body text-stone-700">
          Tell the Archivist what you need to do, in plain language. They will forge it into a quest
          for the Tome.
        </Text>

        <Text className="mb-2 font-body text-xl text-stone-700">What&apos;s the endeavor?</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          multiline
          placeholder="e.g., Finish the thermo lab report by Friday"
          placeholderTextColor="#57534e"
          textAlignVertical="top"
          className="mb-4 min-h-[140px] rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 font-body text-stone-900"
        />

        {error ? <Text className="mb-4 font-body text-xl text-red-700">{error}</Text> : null}

        <Pressable
          onPress={onForge}
          disabled={!input.trim()}
          className={`rounded-md px-4 py-3 ${input.trim() ? 'bg-amber-600 active:bg-amber-700' : 'bg-amber-100/40'}`}
        >
          <Text className="text-center font-display text-2xl text-stone-900">
            Forge with the Archivist
          </Text>
        </Pressable>
        </ScrollView>
      </ParchmentScreen>
    );
  }

  // Review phase, draft is set.
  if (!draft) return null;

  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
      <Animated.View entering={ParchmentUnfurl}>
      <Text className="mb-1 font-display text-lg uppercase tracking-widest text-amber-800">
        {draft.fromFallback ? 'Templated draft' : 'The Archivist offers'}
      </Text>
      <Text className="mb-6 font-display text-4xl text-stone-900">Review the quest</Text>

      {draft.tactical_warnings.length > 0 ? (
        <View className="mb-6 rounded-md border border-amber-900/40 bg-amber-950/20 p-4">
          <Text className="mb-1 font-display text-lg uppercase tracking-widest text-amber-800">
            Tactical warnings
          </Text>
          {draft.tactical_warnings.map((w, i) => (
            <Text key={i} className="font-body text-xl text-stone-700">
              · {w}
            </Text>
          ))}
        </View>
      ) : null}

      <Text className="mb-2 font-body text-xl text-stone-700">Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        editable={!submitting}
        className="mb-4 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 font-body text-stone-900"
      />

      <Text className="mb-2 font-body text-xl text-stone-700">Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        multiline
        editable={!submitting}
        textAlignVertical="top"
        className="mb-4 min-h-[112px] rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 font-body text-stone-900"
      />

      <DropdownPicker
        label="Tier"
        value={tier}
        onChange={setTier}
        disabled={submitting}
        headerInMenu="Choose the tier"
        options={TIERS.map((t) => ({
          value: t,
          label: t,
          rightLabel: `${xpForTier(t)} XP`,
        }))}
      />

      <DropdownPicker
        label="Classification"
        value={classification}
        onChange={setClassification}
        disabled={submitting}
        headerInMenu="Choose the classification"
        options={CLASSIFICATIONS.map((c) => ({
          value: c,
          label: c,
          description: CLASSIFICATION_DESCRIPTIONS[c],
        }))}
      />

      <DropdownPicker
        label="Recurrence"
        value={recurrence}
        onChange={setRecurrence}
        disabled={submitting}
        headerInMenu="Choose the cadence"
        options={RECURRENCES.map((r) => ({
          value: r,
          label: RECURRENCE_LABELS[r],
          description: RECURRENCE_DESCRIPTIONS[r],
        }))}
      />

      {recurrence === 'custom' ? (
        <View className="mb-4 rounded-md border border-amber-900/40 bg-amber-50/40 p-4">
          <Text className="mb-2 font-body text-base text-stone-600">Repeat every…</Text>
          <View className="flex-row gap-2">
            <TextInput
              value={recurrenceInterval}
              onChangeText={(t) => setRecurrenceInterval(t.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              editable={!submitting}
              className="w-24 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 font-body text-xl text-stone-900"
            />
            <View className="flex-1">
              <DropdownPicker
                label=""
                value={recurrenceUnit}
                onChange={setRecurrenceUnit}
                disabled={submitting}
                headerInMenu="Choose the unit"
                options={RECURRENCE_UNITS.map((u) => ({
                  value: u,
                  label: RECURRENCE_UNIT_LABELS[u],
                }))}
                showSelectedRightLabel={false}
              />
            </View>
          </View>
        </View>
      ) : null}

      {recurrence === 'weekly' ? (
        <WeekdayChips
          value={recurrenceWeekdays}
          onChange={setRecurrenceWeekdays}
          disabled={submitting}
        />
      ) : null}

      {recurrence === 'monthly' ? (
        <MonthDayChips
          value={recurrenceMonthDays}
          onChange={setRecurrenceMonthDays}
          disabled={submitting}
        />
      ) : null}

      {/* Faction + Campaign pickers carry their own labels via DropdownPicker
          so the parent doesn't need a wrapping View+Text, keeps spacing
          consistent with the other dropdowns on this form. */}
      <FactionPicker value={factionId} onChange={setFactionId} disabled={submitting} />
      <CampaignPicker
        value={campaignId}
        onChange={(next) => {
          setCampaignId(next);
          // When a campaign is first linked, seed the % from the tier so
          // the input doesn't look empty. Clear when unlinked.
          if (next && (!campaignId || campaignContributionPct === '')) {
            setCampaignContributionPct(String(defaultPctForTier(tier)));
          }
        }}
        disabled={submitting}
      />
      {campaignId ? (
        <View className="mb-4 rounded-md border border-amber-900/40 bg-amber-50/40 p-4">
          <Text className="mb-2 font-body text-base text-stone-600">
            Completing this quest advances the campaign by…
          </Text>
          <View className="flex-row items-center gap-2">
            <TextInput
              value={campaignContributionPct}
              onChangeText={(t) => setCampaignContributionPct(t.replace(/[^0-9]/g, '').slice(0, 3))}
              keyboardType="number-pad"
              editable={!submitting}
              className="w-20 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 font-body text-xl text-stone-900"
            />
            <Text className="font-body text-xl text-stone-700">%</Text>
          </View>
          <Text className="mt-2 font-body text-sm italic text-stone-500">
            0-100. Use 0 to track the quest under the campaign without moving the
            bar. The campaign auto-closes the moment progress reaches 100%.
          </Text>
        </View>
      ) : null}

      <View className="mb-6">
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="font-body text-xl text-stone-700">Objectives</Text>
          {objectives.length > 1 ? (
            // GHPressable: flipping reorderMode mounts a fresh set of
            // GestureDetectors in the children below, and RN's stock
            // Pressable would leave the responder stuck after the tap.
            // GH's Pressable releases cleanly. NativeWind className is
            // dropped by GHPressable, so styling moves to a wrapping View.
            <GHPressable
              onPress={() => setReorderingObjectives((v) => !v)}
              disabled={submitting}
            >
              <View className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-1">
                <Text className="font-body text-base text-stone-700">
                  {reorderingObjectives ? 'Done' : 'Reorder'}
                </Text>
              </View>
            </GHPressable>
          ) : null}
        </View>
        <ObjectivesEditor
          objectives={objectives}
          onChange={setObjectives}
          disabled={submitting}
          reorderMode={reorderingObjectives}
        />
      </View>

      <Text className="mb-2 font-body text-xl text-stone-700">Granted buff (optional)</Text>
      <View className="mb-6">
        <BuffEditor draft={buff} onChange={setBuff} questTier={tier} disabled={submitting} />
      </View>

      <DeadlinePicker
        value={deadlineIso}
        onChange={setDeadlineIso}
        disabled={submitting}
      />

      {error ? <Text className="mb-4 font-body text-xl text-red-700">{error}</Text> : null}

      <View className="mb-3 flex-row gap-3">
        <Pressable
          onPress={onSave}
          disabled={submitting || !title.trim()}
          className={`flex-1 rounded-md px-4 py-3 ${submitting || !title.trim() ? 'bg-amber-100/40' : 'bg-amber-600 active:bg-amber-700'}`}
        >
          <Text className="text-center font-display text-2xl text-stone-900">
            {submitting ? 'Saving…' : 'Save quest'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onRegenerate}
          disabled={submitting}
          className="rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-stone-700">Regenerate</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={onDiscard}
        disabled={submitting}
        className="rounded-md px-4 py-3 active:bg-amber-50/40"
      >
        <Text className="text-center font-body text-xl text-stone-500">Discard and start over</Text>
      </Pressable>
      </Animated.View>
      </ScrollView>
    </ParchmentScreen>
  );
}
