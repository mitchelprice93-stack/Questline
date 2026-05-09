import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

const TIERS: QuestTier[] = ['trivial', 'minor', 'standard', 'major', 'legendary'];
const CLASSIFICATIONS: QuestClassification[] = ['daily', 'side', 'main', 'legendary'];
type RecurrenceChoice = 'none' | 'daily' | 'weekly';
const RECURRENCES: RecurrenceChoice[] = ['none', 'daily', 'weekly'];

function recurrenceForDb(choice: RecurrenceChoice): QuestRecurrence {
  return choice === 'none' ? null : choice;
}
function recurrenceForUi(value: QuestRecurrence): RecurrenceChoice {
  return value ?? 'none';
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
  /** Triggering quest title — passed into the AI narration. */
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
  const [editBuff, setEditBuff] = useState<BuffDraft>(emptyBuffDraft());
  const [editCampaignId, setEditCampaignId] = useState<string | null>(null);
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
      // A negative net modifier means a debuff just landed and was applied —
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
        const fresh = await getQuest(quest.id);
        if (fresh) setQuest(fresh);
        refetchProfile();
        setBusy(null);
      } else {
        await showInfoMessage(
          'Quest completed',
          `+${result.xpChange} XP earned${modifierLine}${buffLine} · ${result.newTotalXp} total`,
        );
        goBack();
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
      // The Mark of the Forsaken just landed — match it with the audio cue.
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
    setEditBuff(buffDraftFromQuest(quest));
    setEditCampaignId(quest.campaign_id);
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
      const updated = await updateQuest(quest.id, {
        title: editTitle.trim(),
        description: editDescription.trim() ? editDescription.trim() : null,
        tier: editTier,
        classification: editClassification,
        deadline: deadlineIso,
        recurrence: recurrenceForDb(editRecurrence),
        grantedBuff: buffDraftToPayload(editBuff),
        campaignId: editCampaignId,
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
    return <LevelUpTakeover {...levelUp} onContinue={goBack} />;
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

        <Text className="mb-2 font-body text-xl text-stone-700">
          Tier · grants {xpForTier(editTier)} XP
        </Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {TIERS.map((t) => (
            <Chip key={t} label={t} selected={editTier === t} onPress={() => setEditTier(t)} />
          ))}
        </View>

        <Text className="mb-2 font-body text-xl text-stone-700">Classification</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {CLASSIFICATIONS.map((c) => (
            <Chip
              key={c}
              label={c}
              selected={editClassification === c}
              onPress={() => setEditClassification(c)}
            />
          ))}
        </View>

        <Text className="mb-2 font-body text-xl text-stone-700">Recurrence</Text>
        <View className="mb-1 flex-row flex-wrap gap-2">
          {RECURRENCES.map((r) => (
            <Chip
              key={r}
              label={r}
              selected={editRecurrence === r}
              onPress={() => setEditRecurrence(r)}
            />
          ))}
        </View>
        <Text className="mb-4 font-body text-lg text-stone-500">
          {editRecurrence === 'none'
            ? 'A one-time quest. Completes once and goes to the log.'
            : editRecurrence === 'daily'
              ? 'Resets each day. Streak grows on consecutive days.'
              : 'Resets each week. Streak grows on consecutive weeks.'}
        </Text>

        <Text className="mb-2 font-body text-xl text-stone-700">Objectives</Text>
        <View className="mb-6">
          <ObjectivesEditor
            objectives={editObjectives}
            onChange={setEditObjectives}
            disabled={busy === 'save-edits'}
          />
        </View>

        <View className="mb-6">
          <Text className="mb-2 font-body text-xl text-stone-700">Faction (optional)</Text>
          <FactionPicker
            value={editFactionId}
            onChange={setEditFactionId}
            disabled={busy === 'save-edits'}
          />
        </View>

        <View className="mb-6">
          <Text className="mb-2 font-body text-xl text-stone-700">Campaign (optional)</Text>
          <CampaignPicker
            value={editCampaignId}
            onChange={setEditCampaignId}
            disabled={busy === 'save-edits'}
          />
        </View>

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
          Plain language is fine — the Tome reads dates loosely. Leave blank to remove.
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

  // View mode — read-only display + actions.
  const onCooldown = isCompletedThisPeriod(quest.recurrence, quest.last_completed_at);
  const cooldownLabel = recurrenceStatusLabel(quest.recurrence, quest.last_completed_at);
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
            {quest.recurrence === 'daily' ? 'Daily quest' : 'Weekly quest'}
          </Text>
          <View className="mt-1 flex-row items-baseline justify-between">
            <Text className="font-body text-xl text-stone-700">
              {quest.streak_count > 0
                ? `Streak · ${quest.streak_count} ${quest.recurrence === 'daily' ? 'days' : 'weeks'}`
                : 'No streak yet — complete to start one'}
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

// Phase 3.6 — full-screen takeover when a quest completion crosses a level
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

  // Play the level-up sting once on mount — independent of the AI call.
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
