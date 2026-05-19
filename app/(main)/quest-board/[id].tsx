import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { DropdownPicker } from '../../../components/dropdown-picker';
import { useAuth } from '../../../lib/auth';
import {
  deadlineUrgency,
  formatDeadline,
  formatDeadlineRelative,
  isCompletedThisPeriod,
  parseDeadline,
  recurrenceStatusLabel,
  urgencyClasses,
} from '../../../lib/dates';
import { confirmDestructive, showInfoMessage } from '../../../lib/dialogs';
import {
  buffDurationDaysForTier,
  calculateLevel,
  xpForTier,
  type QuestTier,
} from '../../../lib/engine/xp';
import { generateLevelUpNarration } from '../../../lib/level-up';
import { ParchmentScreen } from '../../../lib/parchment';
import { retitleFactionFromQuest, shouldRetitle } from '../../../lib/reputation';
import { playSfx } from '../../../lib/sfx';
import {
  abandonQuest,
  completeQuest,
  getQuest,
  updateQuest,
  updateQuestObjectives,
} from '../../../lib/quests';
import type {
  Quest,
  QuestClassification,
  QuestObjective,
  QuestRecurrence,
} from '../../../lib/types/models';
import {
  BuffEditor,
  buffDraftFromQuest,
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

// Display + description tables shared with the new-quest form's dropdowns.
// Keep in sync with app/(main)/quest-board/new.tsx, divergence would
// mean the chronicler sees different copy when creating vs editing,
// which is jarring.
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
function recurrenceForUi(value: QuestRecurrence): RecurrenceChoice {
  return value ?? 'none';
}

// Tier-scaled default for campaign_contribution_pct. Mirrors new.tsx.
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

interface LevelUpState {
  oldLevel: number;
  newLevel: number;
  newTotalXp: number;
  xpChange: number;
  /** Bonus XP awarded for hitting a streak milestone, surfaced separately. */
  milestoneBonus?: number;
  /** Streak after this completion (for recurring quests). */
  newStreak?: number;
  /** Triggering quest title, passed into the AI narration. */
  triggeringQuestTitle: string;
  /** Tier of the triggering quest. */
  triggeringQuestTier: QuestTier;
  /** Buff name granted by this completion, if any. */
  buffGranted: string | null;
}

export default function QuestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile, refetchProfile } = useAuth();
  const [quest, setQuest] = useState<Quest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'complete' | 'abandon' | 'save-edits' | null>(null);
  const [levelUp, setLevelUp] = useState<LevelUpState | null>(null);
  // Holds the in-flight reputation retitle when a level-up fires at the
  // same time as a major/legendary faction quest completion. Read by the
  // takeover's onContinue so we can announce the new title after the
  // takeover dismisses, instead of swallowing it silently.
  const pendingRetitleRef = useRef<Promise<{
    newTitle: string;
    previousTitle: string;
  } | null> | null>(null);
  // Toggle the gold-shimmer overlay briefly on a successful completion.
  const [showShimmer, setShowShimmer] = useState(false);

  // Edit-mode state. Populated from the loaded quest on entry, written back via
  // updateQuest on save.
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTier, setEditTier] = useState<QuestTier>('standard');
  const [editClassification, setEditClassification] = useState<QuestClassification>('side');
  const [editObjectives, setEditObjectives] = useState<QuestObjective[]>([]);
  const [editDeadline, setEditDeadline] = useState('');
  const [editRecurrence, setEditRecurrence] = useState<RecurrenceChoice>('none');
  // Custom-cadence config, only meaningful when editRecurrence === 'custom'.
  const [editRecurrenceInterval, setEditRecurrenceInterval] = useState<string>('3');
  const [editRecurrenceUnit, setEditRecurrenceUnit] = useState<RecurrenceUnit>('days');
  // Weekly pinned weekdays / monthly pinned month-days. Empty = "once per period".
  const [editRecurrenceWeekdays, setEditRecurrenceWeekdays] = useState<number[]>([]);
  const [editRecurrenceMonthDays, setEditRecurrenceMonthDays] = useState<number[]>([]);
  const [editBuff, setEditBuff] = useState<BuffDraft>(emptyBuffDraft());
  const [editCampaignId, setEditCampaignId] = useState<string | null>(null);
  // Per-quest campaign contribution %; string for TextInput, parsed at save.
  const [editCampaignContributionPct, setEditCampaignContributionPct] = useState<string>('10');
  const [editFactionId, setEditFactionId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getQuest(id)
      .then((q) => {
        if (!cancelled) setQuest(q);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Awaits the (already-running) retitle call and shows a follow-up
  // message if the Archivist proposed a new title. Silent when the
  // promise resolves to null, the AI either declined to retitle, the
  // quest didn't qualify, or the call failed (logged to console).
  const announceRetitle = async (
    pending: Promise<{ newTitle: string; previousTitle: string } | null>,
  ) => {
    const result = await pending;
    if (!result) return;
    await showInfoMessage(
      'The Tome inscribes a new standing',
      `${result.previousTitle} → ${result.newTitle}`,
    );
  };

  const onComplete = async () => {
    if (!quest) return;
    setBusy('complete');
    setActionError(null);
    try {
      // Derive oldLevel from total_xp, NOT profile.level. The latter is set
      // once at character creation and never refreshed; trusting it makes
      // the level-up animation fire on every completion after the user
      // crosses any threshold past their starting level.
      const oldLevel = calculateLevel(profile?.total_xp ?? 0).level;
      const result = await completeQuest(quest.id);
      const { level: newLevel } = calculateLevel(result.newTotalXp);
      // Major / legendary quests tied to a faction earn a fresh reputation
      // title from the Archivist. Fire this in parallel with the rest of
      // the completion UI, its latency shouldn't compound.
      const retitlePromise = shouldRetitle(quest)
        ? retitleFactionFromQuest(quest.faction_id as string, quest)
        : Promise.resolve(null);
      const milestoneLine =
        result.milestoneBonus > 0
          ? ` · streak ${result.newStreak} milestone bonus +${result.milestoneBonus} XP`
          : '';
      const streakLine = result.newStreak > 0 ? ` · streak ${result.newStreak}` : '';
      const modifierLine =
        result.netModifierPct > 0
          ? ` · modifiers +${result.netModifierPct}%`
          : result.netModifierPct < 0
            ? ` · modifiers ${result.netModifierPct}%`
            : '';
      const buffLine = result.buffGranted
        ? ` · earned: ${result.buffGranted}`
        : '';
      // SFX: completion bell first, then any earned beats stack underneath.
      // A negative net modifier means a debuff just landed and was applied -
      // play the debuff cue alongside completion so the user hears the cost.
      playSfx('quest_complete');
      if (result.netModifierPct < 0) playSfx('debuff_applied');
      if (result.buffGranted) playSfx('buff_earned');
      if (result.milestoneBonus > 0) playSfx('streak_milestone');
      // Visual companion to the bell: brief gold shimmer over the screen.
      // Skipped when the level-up takeover is about to render (it has its
      // own dramatic reveal) so we don't fire two effects at once.
      const willLevelUp = newLevel > oldLevel;
      if (!willLevelUp) {
        setShowShimmer(true);
        setTimeout(() => setShowShimmer(false), 700);
      }
      if (newLevel > oldLevel) {
        refetchProfile();
        // Level-up sting plays on takeover mount (see LevelUpTakeover).
        setLevelUp({
          oldLevel,
          newLevel,
          newTotalXp: result.newTotalXp,
          xpChange: result.xpChange,
          milestoneBonus: result.milestoneBonus,
          newStreak: result.newStreak,
          triggeringQuestTitle: quest.title,
          triggeringQuestTier: quest.tier,
          buffGranted: result.buffGranted,
        });
      } else if (quest.recurrence) {
        // Recurring: stay on the page so the user can see the streak update.
        // Refresh quest to pick up the new last_completed_at + streak_count.
        await showInfoMessage(
          'Quest completed',
          `+${result.xpChange} XP earned${streakLine}${milestoneLine}${modifierLine}${buffLine}`,
        );
        await announceRetitle(retitlePromise);
        const fresh = await getQuest(quest.id);
        if (fresh) setQuest(fresh);
        refetchProfile();
        setBusy(null);
      } else {
        await showInfoMessage(
          'Quest completed',
          `+${result.xpChange} XP earned${modifierLine}${buffLine} · ${result.newTotalXp} total`,
        );
        await announceRetitle(retitlePromise);
        goBack();
      }
      // For the level-up branch, the takeover owns the immediate moment -
      // we stash the retitle promise so the takeover's onContinue can
      // announce it after the user dismisses, rather than silently. The
      // DB write happens whenever the promise resolves; the announcement
      // waits for the user.
      if (newLevel > oldLevel) {
        pendingRetitleRef.current = retitlePromise;
      }
    } catch (e) {
      playSfx('error');
      setActionError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const toggleObjective = async (idx: number) => {
    if (!quest) return;
    const previous = quest;
    const newObjectives = quest.objectives.map((o, i) =>
      i === idx ? { ...o, completed: !o.completed } : o,
    );
    setQuest({ ...quest, objectives: newObjectives });
    setActionError(null);
    playSfx('objective_check');
    try {
      await updateQuestObjectives(quest.id, newObjectives);
    } catch (e) {
      setQuest(previous);
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const onAbandon = async () => {
    if (!quest) return;
    const proceed = await confirmDestructive(
      'Abandon quest?',
      'No XP will be granted. This cannot be undone.',
    );
    if (!proceed) return;
    setBusy('abandon');
    setActionError(null);
    try {
      await abandonQuest(quest.id);
      // The Mark of the Forsaken just landed, match it with the audio cue.
      // Hold the navigation back briefly so the SFX has time to start before
      // the screen unmounts; otherwise on web the audio context can be cut.
      playSfx('debuff_applied');
      setTimeout(goBack, 250);
    } catch (e) {
      playSfx('error');
      setActionError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const onEnterEdit = () => {
    if (!quest) return;
    setEditTitle(quest.title);
    setEditDescription(quest.description ?? '');
    setEditTier(quest.tier);
    setEditClassification(quest.classification);
    setEditObjectives(quest.objectives);
    // Pre-fill with the human-readable form so the user can re-edit naturally.
    setEditDeadline(formatDeadline(quest.deadline) ?? '');
    setEditRecurrence(recurrenceForUi(quest.recurrence));
    // Pre-fill custom-cadence inputs from the persisted values. Defaults
    // to "every 3 days" when the quest isn't custom so the conditional
    // UI has something sensible if the user switches to Custom.
    setEditRecurrenceInterval(String(quest.recurrence_interval ?? 3));
    setEditRecurrenceUnit((quest.recurrence_unit as RecurrenceUnit) ?? 'days');
    setEditRecurrenceWeekdays(quest.recurrence_weekdays ?? []);
    setEditRecurrenceMonthDays(quest.recurrence_month_days ?? []);
    setEditBuff(buffDraftFromQuest(quest));
    setEditCampaignId(quest.campaign_id);
    setEditCampaignContributionPct(
      quest.campaign_contribution_pct != null
        ? String(quest.campaign_contribution_pct)
        : String(defaultPctForTier(quest.tier)),
    );
    setEditFactionId(quest.faction_id);
    setActionError(null);
    setEditMode(true);
  };

  const onCancelEdit = () => {
    setEditMode(false);
    setActionError(null);
  };

  // router.back() throws when there's no history (deep link, browser refresh).
  // Fall through to a quest-board push so the user is never trapped.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/quest-board');
  };

  const onSaveEdits = async () => {
    if (!quest) return;
    let deadlineIso: string | null = null;
    if (editDeadline.trim()) {
      const parsed = parseDeadline(editDeadline);
      if (!parsed) {
        playSfx('error');
        setActionError(
          `Couldn't read "${editDeadline.trim()}" as a date. Try something like "May 15, 2026", "5/15/26", or "next Friday".`,
        );
        return;
      }
      deadlineIso = parsed.toISOString();
    }
    setBusy('save-edits');
    setActionError(null);
    try {
      // Validate custom-cadence inputs.
      const parsedInterval =
        editRecurrence === 'custom'
          ? Math.max(1, Math.floor(Number(editRecurrenceInterval) || 0))
          : null;
      if (editRecurrence === 'custom' && (!parsedInterval || parsedInterval < 1)) {
        playSfx('error');
        setActionError('Custom cadence needs a positive number for the interval.');
        setBusy(null);
        return;
      }
      // Validate + clamp campaign % when a campaign is linked. 0 is
      // allowed, "link without moving the bar". Matches DB CHECK.
      let parsedPct: number | null = null;
      if (editCampaignId) {
        const raw = Math.floor(Number(editCampaignContributionPct) || 0);
        if (raw < 0 || raw > 100) {
          playSfx('error');
          setActionError('Campaign contribution must be between 0 and 100.');
          setBusy(null);
          return;
        }
        parsedPct = raw;
      }
      const updated = await updateQuest(quest.id, {
        title: editTitle.trim(),
        description: editDescription.trim() ? editDescription.trim() : null,
        tier: editTier,
        classification: editClassification,
        deadline: deadlineIso,
        recurrence: recurrenceForDb(editRecurrence),
        recurrenceInterval: parsedInterval,
        recurrenceUnit: editRecurrence === 'custom' ? editRecurrenceUnit : null,
        recurrenceWeekdays: editRecurrence === 'weekly' ? editRecurrenceWeekdays : null,
        recurrenceMonthDays: editRecurrence === 'monthly' ? editRecurrenceMonthDays : null,
        grantedBuff: buffDraftToPayload(editBuff),
        campaignId: editCampaignId,
        campaignContributionPct: parsedPct,
        factionId: editFactionId,
        objectives: editObjectives
          .map((o) => ({ ...o, text: o.text.trim() }))
          .filter((o) => o.text.length > 0),
      });
      playSfx('quest_create'); // same ceremonial scratch as forge-time
      setQuest(updated);
      setEditMode(false);
      setBusy(null);
    } catch (e) {
      playSfx('error');
      setActionError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  if (levelUp) {
    const onTakeoverContinue = async () => {
      // Drain the retitle promise stashed during onComplete (if any)
      // so the user sees their new faction standing AFTER the takeover.
      const pending = pendingRetitleRef.current;
      pendingRetitleRef.current = null;
      if (pending) await announceRetitle(pending);
      goBack();
    };
    return <LevelUpTakeover {...levelUp} onContinue={onTakeoverContinue} />;
  }

  if (loadError) {
    return (
      <ParchmentScreen>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="font-body text-red-700">{loadError}</Text>
        </View>
      </ParchmentScreen>
    );
  }
  if (!quest) {
    return (
      <ParchmentScreen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#78350f" />
        </View>
      </ParchmentScreen>
    );
  }

  if (editMode) {
    const canSave = editTitle.trim().length > 0 && busy !== 'save-edits';
    return (
      <ParchmentScreen>
        <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
        <Pressable onPress={onCancelEdit} className="mb-3 self-start active:opacity-60">
          <Text className="font-body text-xl text-amber-800">← Cancel edit</Text>
        </Pressable>
        <Text className="mb-1 font-display text-lg uppercase tracking-widest text-amber-800">
          Editing quest
        </Text>
        <Text className="mb-6 font-display text-4xl text-stone-900">{quest.title}</Text>

        <Text className="mb-2 font-body text-xl text-stone-700">Title</Text>
        <TextInput
          value={editTitle}
          onChangeText={setEditTitle}
          editable={busy !== 'save-edits'}
          className="mb-4 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 font-body text-stone-900"
        />

        <Text className="mb-2 font-body text-xl text-stone-700">Description</Text>
        <TextInput
          value={editDescription}
          onChangeText={setEditDescription}
          multiline
          editable={busy !== 'save-edits'}
          textAlignVertical="top"
          className="mb-4 min-h-[112px] rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 font-body text-stone-900"
        />

        <DropdownPicker
          label="Tier"
          value={editTier}
          onChange={setEditTier}
          disabled={busy === 'save-edits'}
          headerInMenu="Choose the tier"
          options={TIERS.map((t) => ({
            value: t,
            label: t,
            rightLabel: `${xpForTier(t)} XP`,
          }))}
        />

        <DropdownPicker
          label="Classification"
          value={editClassification}
          onChange={setEditClassification}
          disabled={busy === 'save-edits'}
          headerInMenu="Choose the classification"
          options={CLASSIFICATIONS.map((c) => ({
            value: c,
            label: c,
            description: CLASSIFICATION_DESCRIPTIONS[c],
          }))}
        />

        <DropdownPicker
          label="Recurrence"
          value={editRecurrence}
          onChange={setEditRecurrence}
          disabled={busy === 'save-edits'}
          headerInMenu="Choose the cadence"
          options={RECURRENCES.map((r) => ({
            value: r,
            label: RECURRENCE_LABELS[r],
            description: RECURRENCE_DESCRIPTIONS[r],
          }))}
        />

        {editRecurrence === 'custom' ? (
          <View className="mb-4 rounded-md border border-amber-900/40 bg-amber-50/40 p-4">
            <Text className="mb-2 font-body text-base text-stone-600">Repeat every…</Text>
            <View className="flex-row gap-2">
              <TextInput
                value={editRecurrenceInterval}
                onChangeText={(t) =>
                  setEditRecurrenceInterval(t.replace(/[^0-9]/g, '').slice(0, 4))
                }
                keyboardType="number-pad"
                editable={busy !== 'save-edits'}
                className="w-24 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 font-body text-xl text-stone-900"
              />
              <View className="flex-1">
                <DropdownPicker
                  label=""
                  value={editRecurrenceUnit}
                  onChange={setEditRecurrenceUnit}
                  disabled={busy === 'save-edits'}
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

        {editRecurrence === 'weekly' ? (
          <WeekdayChips
            value={editRecurrenceWeekdays}
            onChange={setEditRecurrenceWeekdays}
            disabled={busy === 'save-edits'}
          />
        ) : null}

        {editRecurrence === 'monthly' ? (
          <MonthDayChips
            value={editRecurrenceMonthDays}
            onChange={setEditRecurrenceMonthDays}
            disabled={busy === 'save-edits'}
          />
        ) : null}

        <Text className="mb-2 font-body text-xl text-stone-700">Objectives</Text>
        <View className="mb-6">
          <ObjectivesEditor
            objectives={editObjectives}
            onChange={setEditObjectives}
            disabled={busy === 'save-edits'}
          />
        </View>

        {/* Faction + Campaign pickers carry their own labels via DropdownPicker. */}
        <FactionPicker
          value={editFactionId}
          onChange={setEditFactionId}
          disabled={busy === 'save-edits'}
        />
        <CampaignPicker
          value={editCampaignId}
          onChange={(next) => {
            setEditCampaignId(next);
            if (next && (!editCampaignId || editCampaignContributionPct === '')) {
              setEditCampaignContributionPct(String(defaultPctForTier(editTier)));
            }
          }}
          disabled={busy === 'save-edits'}
        />
        {editCampaignId ? (
          <View className="mb-4 rounded-md border border-amber-900/40 bg-amber-50/40 p-4">
            <Text className="mb-2 font-body text-base text-stone-600">
              Completing this quest advances the campaign by…
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={editCampaignContributionPct}
                onChangeText={(t) =>
                  setEditCampaignContributionPct(t.replace(/[^0-9]/g, '').slice(0, 3))
                }
                keyboardType="number-pad"
                editable={busy !== 'save-edits'}
                className="w-20 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 font-body text-xl text-stone-900"
              />
              <Text className="font-body text-xl text-stone-700">%</Text>
            </View>
            <Text className="mt-2 font-body text-sm italic text-stone-500">
              0–100. Use 0 to keep the quest linked to the campaign without
              moving the bar. The campaign auto-closes at 100%.
            </Text>
          </View>
        ) : null}

        <Text className="mb-2 font-body text-xl text-stone-700">Granted buff (optional)</Text>
        <View className="mb-6">
          <BuffEditor
            draft={editBuff}
            onChange={setEditBuff}
            questTier={editTier}
            disabled={busy === 'save-edits'}
          />
        </View>

        <Text className="mb-2 font-body text-xl text-stone-700">Deadline (optional)</Text>
        <TextInput
          value={editDeadline}
          onChangeText={setEditDeadline}
          autoCapitalize="none"
          placeholder="e.g., May 15, 2026 · 5/15/26 · next Friday"
          placeholderTextColor="#57534e"
          className="mb-1 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 font-body text-stone-900"
          editable={busy !== 'save-edits'}
        />
        <Text className="mb-6 font-body text-lg text-stone-500">
          Plain language is fine, the Tome reads dates loosely. Leave blank to remove.
        </Text>

        {actionError ? (
          <Text className="mb-4 font-body text-xl text-red-700">{actionError}</Text>
        ) : null}

        <View className="flex-row gap-3">
          <Pressable
            onPress={onSaveEdits}
            disabled={!canSave}
            className={`flex-1 rounded-md px-4 py-3 ${canSave ? 'bg-amber-600 active:bg-amber-700' : 'bg-amber-100/40'}`}
          >
            <Text className="text-center font-display text-2xl text-stone-900">
              {busy === 'save-edits' ? 'Saving…' : 'Save changes'}
            </Text>
          </Pressable>
          <Pressable
            onPress={onCancelEdit}
            disabled={busy === 'save-edits'}
            className="rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
          >
            <Text className="text-center font-body text-stone-700">Cancel</Text>
          </Pressable>
        </View>
        </ScrollView>
      </ParchmentScreen>
    );
  }

  // View mode, read-only display + actions.
  const pins = {
    weekdays: quest.recurrence_weekdays,
    monthDays: quest.recurrence_month_days,
  };
  const onCooldown = isCompletedThisPeriod(
    quest.recurrence,
    quest.last_completed_at,
    new Date(),
    quest.recurrence_interval,
    quest.recurrence_unit,
    pins,
  );
  const cooldownLabel = recurrenceStatusLabel(
    quest.recurrence,
    quest.last_completed_at,
    new Date(),
    quest.recurrence_interval,
    quest.recurrence_unit,
    pins,
  );
  const isActive = quest.status === 'active';
  const lifecycleStamp =
    quest.status === 'completed' && quest.completed_at
      ? `Completed ${formatLifecycleDate(quest.completed_at)}`
      : quest.status === 'abandoned' && quest.abandoned_at
        ? `Abandoned ${formatLifecycleDate(quest.abandoned_at)}`
        : null;
  return (
    <ParchmentScreen>
      {showShimmer ? <CompletionShimmer /> : null}
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
      <Pressable onPress={goBack} className="mb-3 self-start active:opacity-60">
        <Text className="font-body text-xl text-amber-800">← Quest Board</Text>
      </Pressable>
      <Text className="mb-1 font-display text-4xl text-stone-900">{quest.title}</Text>
      <View className="mb-6 flex-row gap-3">
        <Text className="font-display text-lg uppercase tracking-widest text-amber-800">
          {quest.tier}
        </Text>
        <Text className="font-body text-lg text-stone-500">·</Text>
        <Text className="font-display text-lg uppercase tracking-widest text-stone-700">
          {quest.classification}
        </Text>
        <Text className="font-body text-lg text-stone-500">·</Text>
        <Text className="font-body text-lg text-stone-700">{quest.xp_reward} XP</Text>
      </View>

      {lifecycleStamp ? (
        <View
          className={`mb-6 rounded-md border px-4 py-3 ${
            quest.status === 'completed'
              ? 'border-emerald-900/40 bg-amber-50/40'
              : 'border-stone-700 bg-amber-50/40'
          }`}
        >
          <Text
            className={`font-display text-lg uppercase tracking-widest ${
              quest.status === 'completed' ? 'text-emerald-800' : 'text-stone-700'
            }`}
          >
            {quest.status === 'completed' ? 'Inscribed in the Tome' : 'Set aside'}
          </Text>
          <Text className="mt-1 font-body text-xl text-stone-700">{lifecycleStamp}</Text>
        </View>
      ) : null}

      {quest.recurrence ? (
        <View className="mb-6 rounded-md border border-amber-900/50 bg-amber-50/40 p-4">
          <Text className="font-display text-lg uppercase tracking-widest text-amber-800">
            {quest.recurrence === 'daily' && 'Daily quest'}
            {quest.recurrence === 'weekly' && 'Weekly quest'}
            {quest.recurrence === 'monthly' && 'Monthly quest'}
            {quest.recurrence === 'yearly' && 'Yearly quest'}
            {quest.recurrence === 'custom' &&
              `Every ${quest.recurrence_interval} ${quest.recurrence_unit}`}
          </Text>
          <View className="mt-1 flex-row items-baseline justify-between">
            <Text className="font-body text-xl text-stone-700">
              {quest.streak_count > 0
                ? `Streak · ${quest.streak_count} ${
                    quest.recurrence === 'daily'
                      ? 'days'
                      : quest.recurrence === 'weekly'
                        ? 'weeks'
                        : quest.recurrence === 'monthly'
                          ? 'months'
                          : quest.recurrence === 'yearly'
                            ? 'years'
                            : 'cycles'
                  }`
                : 'No streak yet, complete to start one'}
            </Text>
            {cooldownLabel ? (
              <Text className="font-body text-lg text-stone-700">{cooldownLabel}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {quest.granted_buff_name && quest.granted_buff_pct !== null ? (
        <View className="mb-6 rounded-md border border-emerald-900/50 bg-amber-50/40 p-4">
          <View className="flex-row items-baseline justify-between">
            <Text className="font-display text-lg uppercase tracking-widest text-emerald-800">
              Granted buff
            </Text>
            <Text className="font-body text-lg text-emerald-800">
              +{quest.granted_buff_pct}%
            </Text>
          </View>
          <Text className="mt-1 font-body-medium text-2xl text-stone-900">
            {quest.granted_buff_name}
          </Text>
          {quest.granted_buff_description ? (
            <Text className="mt-0.5 font-body text-lg text-stone-700">
              {quest.granted_buff_description}
            </Text>
          ) : null}
          <Text className="mt-2 font-body text-lg text-stone-500">
            {quest.granted_buff_condition === 'on_time'
              ? 'Earned if you finish before the deadline.'
              : quest.granted_buff_condition === 'all_objectives'
                ? 'Earned if every objective box is checked.'
                : 'Earned on completion.'}
            {' '}Lasts {buffDurationDaysForTier(quest.tier)} day
            {buffDurationDaysForTier(quest.tier) === 1 ? '' : 's'} once earned.
          </Text>
        </View>
      ) : null}

      {quest.description ? (
        <Text className="mb-6 font-body text-stone-700">{quest.description}</Text>
      ) : (
        <Text className="mb-6 font-body italic text-stone-500">No description.</Text>
      )}

      {quest.deadline
        ? (() => {
            const urgency = deadlineUrgency(quest.deadline);
            const palette = urgency ? urgencyClasses[urgency] : urgencyClasses.normal;
            return (
              <View className={`mb-6 rounded-md border bg-amber-50/40 p-4 ${palette.border}`}>
                <Text className="font-display text-lg uppercase tracking-widest text-stone-500">
                  Deadline
                </Text>
                <Text className="mt-1 font-body text-stone-800">
                  {formatDeadline(quest.deadline)}
                </Text>
                <Text className={`mt-1 font-body text-lg ${palette.text}`}>
                  {formatDeadlineRelative(quest.deadline)}
                </Text>
              </View>
            );
          })()
        : null}

      {quest.objectives.length > 0 ? (
        <View className="mb-6">
          <Text className="mb-2 font-display text-lg uppercase tracking-widest text-stone-500">
            Objectives
          </Text>
          {quest.objectives.map((obj, idx) => (
            <Pressable
              key={idx}
              onPress={() => toggleObjective(idx)}
              disabled={busy !== null || !isActive}
              className="py-1.5 active:opacity-60"
            >
              <Text
                className={
                  obj.completed
                    ? 'font-body text-stone-500 line-through'
                    : 'font-body text-stone-700'
                }
              >
                {obj.completed ? '☑ ' : '☐ '}
                {obj.text}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {actionError ? (
        <Text className="mb-4 font-body text-xl text-red-700">{actionError}</Text>
      ) : null}

      {isActive ? (
        <>
          <Pressable
            onPress={onComplete}
            disabled={busy !== null || onCooldown}
            className={`mb-3 rounded-md px-4 py-3 ${
              busy !== null || onCooldown ? 'bg-amber-100/40' : 'bg-amber-600 active:bg-amber-700'
            }`}
          >
            <Text className="text-center font-display text-2xl text-stone-900">
              {busy === 'complete'
                ? 'Completing…'
                : onCooldown
                  ? cooldownLabel ?? 'Already done this period'
                  : 'Mark complete'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onEnterEdit}
            disabled={busy !== null}
            className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
          >
            <Text className="text-center font-body text-2xl text-stone-800">Edit quest</Text>
          </Pressable>

          <Pressable
            onPress={onAbandon}
            disabled={busy !== null}
            className="rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
          >
            <Text className="text-center font-body text-2xl text-stone-700">
              {busy === 'abandon' ? 'Abandoning…' : 'Abandon quest'}
            </Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={goBack}
          className="rounded-md bg-amber-600 px-4 py-3 active:bg-amber-700"
        >
          <Text className="text-center font-display text-2xl text-stone-900">
            Return to Quest Board
          </Text>
        </Pressable>
      )}
      </ScrollView>
    </ParchmentScreen>
  );
}

/**
 * Brief gold shimmer overlay shown after a successful Mark complete that
 * doesn't trigger a level-up. Two layered Animated.Views: an opaque amber
 * sheet that fades 0 → 0.5 → 0, and a faint cream-white shine that fades
 * a beat behind it. Total duration ~700ms, matching the parent's setTimeout.
 */
function CompletionShimmer() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(450)}
        className="absolute inset-0 bg-amber-400"
        style={{ opacity: 0.5 }}
      />
      <Animated.View
        entering={FadeIn.duration(280).delay(80)}
        exiting={FadeOut.duration(380)}
        className="absolute inset-0 bg-amber-100"
        style={{ opacity: 0.35 }}
      />
    </View>
  );
}

function formatLifecycleDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-3 py-1.5 ${selected ? 'border-amber-500 bg-amber-600/20' : 'border-stone-700 bg-amber-50/40'}`}
    >
      <Text
        className={`font-body-medium text-xl capitalize ${selected ? 'text-amber-800' : 'text-stone-700'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// Phase 3.6, full-screen takeover when a quest completion crosses a level
// threshold. Sequenced fade-in: caption → "LEVEL UP" → new level → XP delta →
// continue button. Dim background reinforces the moment.
function LevelUpTakeover({
  oldLevel,
  newLevel,
  newTotalXp,
  xpChange,
  milestoneBonus,
  newStreak,
  triggeringQuestTitle,
  triggeringQuestTier,
  buffGranted,
  onContinue,
}: LevelUpState & { onContinue: () => void }) {
  const { profile } = useAuth();
  const stagger = (n: number) => FadeInDown.delay(300 + n * 350).duration(700);
  const [narration, setNarration] = useState<string | null>(null);

  // Play the level-up sting once on mount, independent of the AI call.
  useEffect(() => {
    playSfx('level_up_sting');
  }, []);

  // Fetch the AI narration in parallel with the staggered reveal. By the time
  // the user has read past level + delta the narration is usually back; if
  // the network is slow we just let it land when it lands without blocking
  // anything else on screen.
  useEffect(() => {
    let cancelled = false;
    void generateLevelUpNarration({
      character_name: profile?.character_name ?? 'Wanderer',
      character_title: profile?.character_title ?? null,
      old_level: oldLevel,
      new_level: newLevel,
      triggering_quest_title: triggeringQuestTitle,
      triggering_quest_tier: triggeringQuestTier,
      xp_change: xpChange,
      new_total_xp: newTotalXp,
      new_streak: newStreak ?? 0,
      milestone_bonus: milestoneBonus ?? 0,
      buff_granted: buffGranted,
    }).then((text) => {
      if (!cancelled) setNarration(text);
    });
    return () => {
      cancelled = true;
    };
  }, [
    oldLevel,
    newLevel,
    xpChange,
    newTotalXp,
    newStreak,
    milestoneBonus,
    triggeringQuestTitle,
    triggeringQuestTier,
    buffGranted,
    profile?.character_name,
    profile?.character_title,
  ]);

  return (
    <View className="flex-1 items-center justify-center bg-stone-950 px-6">
      <Animated.View entering={FadeIn.duration(400)} className="absolute inset-0 bg-amber-950/10" />
      <Animated.View entering={stagger(0)}>
        <Text className="mb-2 text-center font-display text-lg uppercase tracking-[0.4em] text-amber-400">
          A new threshold
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(1)}>
        <Text className="mb-6 text-center font-display-bold text-5xl text-stone-100">
          LEVEL {newLevel}
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(2)}>
        <Text className="mb-2 text-center font-body text-stone-400">
          From level {oldLevel} to level {newLevel}
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(3)}>
        <Text className="mb-2 text-center font-body text-stone-500">
          +{xpChange.toLocaleString()} XP · {newTotalXp.toLocaleString()} total
        </Text>
      </Animated.View>
      {milestoneBonus && milestoneBonus > 0 && newStreak ? (
        <Animated.View entering={stagger(4)}>
          <Text className="mb-6 text-center font-display text-lg uppercase tracking-[0.3em] text-amber-300">
            {newStreak}-streak milestone · +{milestoneBonus} bonus XP
          </Text>
        </Animated.View>
      ) : (
        <View className="mb-6" />
      )}

      {/* The Archivist's commentary. Shows a loading line while the AI
          call is in flight, then fades the narration in over it.
          Templated fallback fires on error so the slot is never empty. */}
      <View className="mb-10 max-w-md">
        {narration ? (
          <Animated.View entering={FadeIn.duration(900)}>
            <Text className="text-center font-body italic leading-relaxed text-stone-200">
              “{narration}”
            </Text>
          </Animated.View>
        ) : (
          <Text className="text-center font-body italic text-stone-600">
            The Archivist takes up the quill…
          </Text>
        )}
      </View>

      <Animated.View
        entering={stagger(milestoneBonus && milestoneBonus > 0 ? 5 : 4)}
        className="w-full"
      >
        <Pressable
          onPress={onContinue}
          className="rounded-md bg-amber-600 px-4 py-3 active:bg-amber-700"
        >
          <Text className="text-center font-display text-2xl text-stone-100">
            Continue your chronicle
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
