import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ModifierCard } from '../../components/modifier-card';
import { useAnimatedNumber } from '../../lib/animated-number';
import { useAuth } from '../../lib/auth';
import {
  createCampaign,
  createFaction,
  deleteCampaign,
  deleteFaction,
  updateCampaign,
  updateDifficulty,
  updateFaction,
} from '../../lib/character-sheet';
import {
  listActiveBuffs,
  listActiveDebuffs,
  refreshDebuffs,
  restUser,
  type ActiveModifier,
} from '../../lib/debuffs';
import { confirmDestructive, showInfoMessage } from '../../lib/dialogs';
import { calculateLevel, levelProgressFraction, type Difficulty } from '../../lib/engine/xp';
import { errorMessage } from '../../lib/errors';
import { ParchmentScreen } from '../../lib/parchment';
import {
  getActiveQuestCount,
  getCurrentProfile,
  listCampaigns,
  listFactions,
} from '../../lib/profile';
import type { Campaign, Faction, Profile } from '../../lib/types/models';

interface SheetData {
  profile: Profile | null;
  factions: Faction[];
  campaigns: Campaign[];
  activeQuests: number;
  buffs: ActiveModifier[];
  debuffs: ActiveModifier[];
}

const DIFFICULTIES: Difficulty[] = ['apprentice', 'adept', 'master', 'legendary'];

// Sentinel for "user is composing a new row"; kept separate from a real id so
// we never confuse a draft with a saved record.
const DRAFT_ID = '__draft__';

export default function CharacterSheet() {
  const { session, refetchProfile } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Inline-edit state. Only one row of each type can be in edit mode at once.
  const [editingFactionId, setEditingFactionId] = useState<string | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Tick the displayed XP from its previous value to the new total when
  // a quest completes. Must be called before any early returns to satisfy
  // hooks rules. Falls back to 0 when the profile hasn't loaded yet.
  // The hook returns a smooth float; text uses Math.round, but the bar
  // width derives from the raw float so it glides continuously even when
  // the rounded number text snaps integer-by-integer.
  const totalXp = data?.profile?.total_xp ?? 0;
  const animatedTotalXpFloat = useAnimatedNumber(totalXp, 900);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const profile = await getCurrentProfile();
      // Reconcile time-based debuffs before listing so the user always sees
      // a fresh picture, even before the daily cron exists.
      if (profile) {
        try {
          await refreshDebuffs(profile.id);
        } catch (e) {
          // Non-fatal — fall back to whatever's already on file.
          console.warn('refreshDebuffs failed', e);
        }
      }
      const [factions, campaigns, activeQuests, buffs, debuffs] = await Promise.all([
        listFactions(),
        listCampaigns('active'),
        getActiveQuestCount(),
        listActiveBuffs(),
        listActiveDebuffs(),
      ]);
      setData({ profile, factions, campaigns, activeQuests, buffs, debuffs });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void refresh().then(() => {
        if (cancelled) return;
      });
      return () => {
        cancelled = true;
      };
    }, [refresh]),
  );

  const onSetDifficulty = async (next: Difficulty) => {
    if (!data?.profile || data.profile.difficulty === next) return;
    setActionError(null);
    setBusy(true);
    try {
      await updateDifficulty(next);
      await Promise.all([refetchProfile(), refresh()]);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onRest = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const result = await restUser();
      await refresh();
      await showInfoMessage(
        result.clearedCount > 0 ? 'You rest' : 'You rest, but nothing was old enough',
        result.clearedCount > 0
          ? `${result.clearedCount} stale debuff${result.clearedCount === 1 ? '' : 's'} dispelled. Next rest available after ${formatRestDate(result.nextRestAvailableAt)}.`
          : `Debuffs older than 14 days are cleared on rest. Next rest available after ${formatRestDate(result.nextRestAvailableAt)}.`,
      );
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <ParchmentScreen>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="font-body text-red-700">{error}</Text>
        </View>
      </ParchmentScreen>
    );
  }
  if (!data) {
    return (
      <ParchmentScreen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#92400e" />
        </View>
      </ParchmentScreen>
    );
  }

  const { profile, factions, campaigns, activeQuests, buffs, debuffs } = data;
  const restCooldownMs = 7 * 24 * 60 * 60 * 1000;
  const restAvailableAt = profile?.last_rest_at
    ? new Date(profile.last_rest_at).getTime() + restCooldownMs
    : 0;
  const restOnCooldown = Date.now() < restAvailableAt;
  // Round the float for level + integer text values. The bar is driven
  // separately by Reanimated (see AnimatedXpBar below) so its width
  // doesn't ride React's render loop — feeding a percentage style object
  // through the reconciler each frame produced visible stutter on web,
  // even though the text counter (using the same source) read smooth.
  const animatedTotalXp = Math.round(animatedTotalXpFloat);
  const { level, currentLevelXp, nextLevelXp } = calculateLevel(animatedTotalXp);
  const atMaxLevel = nextLevelXp === 0;

  const displayName =
    profile?.character_name ?? profile?.display_name ?? session?.user.email ?? 'Wanderer';

  const showFactionDraft = editingFactionId === DRAFT_ID;
  const showCampaignDraft = editingCampaignId === DRAFT_ID;

  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
      <Text className="mb-1 font-display text-4xl text-stone-900">{displayName}</Text>
      {profile?.character_title ? (
        <Text className="mb-6 font-display text-amber-800">{profile.character_title}</Text>
      ) : (
        <Text className="mb-6 font-body italic text-stone-500">Untitled, for now.</Text>
      )}

      {actionError ? (
        <View className="mb-4 rounded-md border border-red-900 bg-red-950 px-4 py-3">
          <Text className="font-body text-xl text-red-700">{actionError}</Text>
        </View>
      ) : null}

      {/* Level + XP bar */}
      <View className="mb-8 rounded-md border border-stone-800 bg-amber-50/40 p-4">
        <View className="mb-2 flex-row items-baseline justify-between">
          <Text className="font-display text-lg uppercase tracking-widest text-stone-700">
            Level
          </Text>
          <Text className="font-display-bold text-2xl text-stone-900">{level}</Text>
        </View>
        <AnimatedXpBar targetFraction={atMaxLevel ? 1 : levelProgressFraction(totalXp)} />
        <Text className="font-body text-lg text-stone-500">
          {atMaxLevel
            ? `${animatedTotalXp.toLocaleString()} XP · max level reached`
            : `${currentLevelXp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP into this level · ${animatedTotalXp.toLocaleString()} total`}
        </Text>
        <Pressable
          onPress={() => router.push('/xp-history')}
          className="mt-3 active:opacity-60"
        >
          <Text className="font-body text-lg text-amber-800">View XP history →</Text>
        </Pressable>
      </View>

      {/* Active quests */}
      <View className="mb-8 rounded-md border border-stone-800 bg-amber-50/40 p-4">
        <Text className="mb-1 font-display text-lg uppercase tracking-widest text-stone-700">
          Active quests
        </Text>
        <Text className="font-display-bold text-2xl text-stone-900">{activeQuests}</Text>
      </View>

      {/* Buffs — earned by completing quests under their granted-buff
          conditions. Persist for a tier-scaled lifetime; stack while
          active. Hidden when none are active. */}
      {buffs.length > 0 ? (
        <>
          <Text className="mb-2 font-display text-lg uppercase tracking-widest text-stone-700">
            Buffs
          </Text>
          <View className="mb-8 gap-2">
            {buffs.map((b) => (
              <ModifierCard
                key={b.id}
                modifier={b}
                remainingLabel={formatBuffRemaining(b.expires_at)}
              />
            ))}
          </View>
        </>
      ) : null}

      {/* Debuffs — visible whenever any are active. Rest button always
          renders but disables on cooldown. */}
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="font-display text-lg uppercase tracking-widest text-stone-700">
          Debuffs
        </Text>
        <Pressable
          onPress={onRest}
          disabled={busy || restOnCooldown}
          className={`rounded-md border px-3 py-1.5 ${
            busy || restOnCooldown
              ? 'border-stone-800 bg-amber-50/40'
              : 'border-amber-700 bg-amber-900/40 active:bg-amber-900/60'
          }`}
        >
          <Text
            className={`font-body-medium text-lg uppercase tracking-widest ${
              busy || restOnCooldown ? 'text-stone-500' : 'text-amber-800'
            }`}
          >
            {restOnCooldown
              ? `Rest avail. ${formatRestDate(new Date(restAvailableAt).toISOString())}`
              : '+rest'}
          </Text>
        </Pressable>
      </View>
      <View className="mb-8 gap-2">
        {debuffs.length === 0 ? (
          <Text className="font-body italic text-stone-500">
            No debuffs. Keep tending the Tome.
          </Text>
        ) : (
          debuffs.map((d) => <ModifierCard key={d.id} modifier={d} />)
        )}
      </View>

      {/* Factions */}
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="font-display text-lg uppercase tracking-widest text-stone-700">
          Factions
        </Text>
        {!showFactionDraft && editingFactionId === null ? (
          <Pressable onPress={() => setEditingFactionId(DRAFT_ID)} className="active:opacity-60">
            <Text className="font-body text-lg text-amber-800">+ Add</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="mb-8 gap-2">
        {factions.length === 0 && !showFactionDraft ? (
          <Text className="font-body italic text-stone-500">
            The Archivist will inscribe these during character creation.
          </Text>
        ) : null}
        {factions.map((f) =>
          editingFactionId === f.id ? (
            <FactionEditor
              key={f.id}
              initial={f}
              busy={busy}
              onSave={async (patch) => {
                setActionError(null);
                setBusy(true);
                try {
                  await updateFaction(f.id, patch);
                  await refresh();
                  setEditingFactionId(null);
                } catch (e) {
                  setActionError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              onDelete={async () => {
                const ok = await confirmDestructive(
                  'Disband faction?',
                  `"${f.name}" will be unlinked from any quests under it. This can't be undone.`,
                );
                if (!ok) return;
                setActionError(null);
                setBusy(true);
                try {
                  await deleteFaction(f.id);
                  await refresh();
                  setEditingFactionId(null);
                } catch (e) {
                  setActionError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              onCancel={() => setEditingFactionId(null)}
            />
          ) : (
            <Pressable
              key={f.id}
              onPress={() => setEditingFactionId(f.id)}
              disabled={editingFactionId !== null}
              className="rounded-md border border-stone-800 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
            >
              <View className="flex-row items-baseline justify-between">
                <Text className="font-body-medium text-2xl text-stone-900">{f.name}</Text>
                <Text className="font-display text-base uppercase tracking-widest text-amber-800">
                  {f.reputation_title}
                </Text>
              </View>
              <Text className="font-body text-lg text-stone-500">{f.real_world_domain}</Text>
              <Text className="mt-1 font-body text-sm text-stone-600">
                {f.reputation_count} {f.reputation_count === 1 ? 'deed' : 'deeds'} inscribed
              </Text>
            </Pressable>
          ),
        )}
        {showFactionDraft ? (
          <FactionEditor
            initial={null}
            busy={busy}
            onSave={async (patch) => {
              if (!patch.name?.trim() || !patch.real_world_domain?.trim()) return;
              setActionError(null);
              setBusy(true);
              try {
                await createFaction({
                  name: patch.name,
                  real_world_domain: patch.real_world_domain,
                });
                await refresh();
                setEditingFactionId(null);
              } catch (e) {
                setActionError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => setEditingFactionId(null)}
          />
        ) : null}
      </View>

      {/* Campaigns */}
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="font-display text-lg uppercase tracking-widest text-stone-700">
          Campaigns
        </Text>
        {!showCampaignDraft && editingCampaignId === null ? (
          <Pressable onPress={() => setEditingCampaignId(DRAFT_ID)} className="active:opacity-60">
            <Text className="font-body text-lg text-amber-800">+ Add</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="mb-8 gap-2">
        {campaigns.length === 0 && !showCampaignDraft ? (
          <Text className="font-body italic text-stone-500">
            No active arcs. Forge new ones as your chronicle unfolds.
          </Text>
        ) : null}
        {campaigns.map((c) =>
          editingCampaignId === c.id ? (
            <CampaignEditor
              key={c.id}
              initial={c}
              busy={busy}
              onSave={async (patch) => {
                setActionError(null);
                setBusy(true);
                try {
                  await updateCampaign(c.id, patch);
                  await refresh();
                  setEditingCampaignId(null);
                } catch (e) {
                  setActionError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              onDelete={async () => {
                const ok = await confirmDestructive(
                  'Abandon campaign?',
                  `"${c.arc_name}" will be unlinked from any quests under it. This can't be undone.`,
                );
                if (!ok) return;
                setActionError(null);
                setBusy(true);
                try {
                  await deleteCampaign(c.id);
                  await refresh();
                  setEditingCampaignId(null);
                } catch (e) {
                  setActionError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              onCancel={() => setEditingCampaignId(null)}
            />
          ) : (
            <Pressable
              key={c.id}
              onPress={() => setEditingCampaignId(c.id)}
              disabled={editingCampaignId !== null}
              className="rounded-md border border-stone-800 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
            >
              <View className="flex-row items-baseline justify-between">
                <Text className="flex-1 pr-3 font-body-medium text-2xl text-stone-900">
                  {c.arc_name}
                </Text>
                <Text className="font-display text-2xl text-amber-800">
                  {c.progress_pct}%
                </Text>
              </View>
              <Text className="font-body text-lg text-stone-500">{c.real_world_goal}</Text>
              {/* Always-visible progress bar so a fresh 0% campaign still shows
                  the rail it'll fill into. Thicker than before so the visual
                  is more rewarding as quests rack up. */}
              <View className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100/60">
                <View
                  className="h-2 rounded-full bg-amber-600"
                  style={{ width: `${Math.max(c.progress_pct, 1)}%` }}
                />
              </View>
            </Pressable>
          ),
        )}
        {showCampaignDraft ? (
          <CampaignEditor
            initial={null}
            busy={busy}
            onSave={async (patch) => {
              if (!patch.arc_name?.trim() || !patch.real_world_goal?.trim()) return;
              setActionError(null);
              setBusy(true);
              try {
                await createCampaign({
                  arc_name: patch.arc_name,
                  real_world_goal: patch.real_world_goal,
                });
                await refresh();
                setEditingCampaignId(null);
              } catch (e) {
                setActionError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => setEditingCampaignId(null)}
          />
        ) : null}
      </View>

      {/* Difficulty — segmented control. Tapping persists immediately and
          refetches the profile so XP-modifier changes go live everywhere. */}
      <Text className="mb-2 font-display text-lg uppercase tracking-widest text-stone-700">
        Difficulty
      </Text>
      <View className="mb-2 flex-row gap-2">
        {DIFFICULTIES.map((d) => {
          const selected = profile?.difficulty === d;
          return (
            <Pressable
              key={d}
              onPress={() => onSetDifficulty(d)}
              disabled={busy}
              className={`flex-1 rounded-md border px-2 py-2 ${
                selected
                  ? 'border-amber-600 bg-amber-900/40'
                  : 'border-stone-800 bg-amber-50/40 active:bg-amber-100/60'
              }`}
            >
              <Text
                className={`text-center font-body-medium text-lg uppercase tracking-widest ${
                  selected ? 'text-amber-800' : 'text-stone-700'
                }`}
              >
                {d}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="font-body text-lg text-stone-500">
        XP modifier: apprentice 1.5× · adept 1.25× · master 1.0× · legendary 0.75×. Harder
        difficulty earns less XP per quest.
      </Text>
      </ScrollView>
    </ParchmentScreen>
  );
}

function formatRestDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * "Lasts 2 days", "Lasts 6 hours", "Expiring soon". Returns null if the
 * timestamp can't be parsed. Buff entries with no expires_at (legacy or
 * "next completion" flavor) just don't render this line.
 */
function formatBuffRemaining(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'Expiring now';
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return 'Lasts < 1 hour';
  if (hours < 24) return `Lasts ${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `Lasts ${days} day${days === 1 ? '' : 's'}`;
}

// ---- Inline editors --------------------------------------------------------

interface FactionEditorProps {
  initial: Faction | null;
  busy: boolean;
  onSave: (patch: {
    name?: string;
    real_world_domain?: string;
    reputation_title?: string;
  }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void | Promise<void>;
}

function FactionEditor({ initial, busy, onSave, onCancel, onDelete }: FactionEditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [domain, setDomain] = useState(initial?.real_world_domain ?? '');
  const [reputation, setReputation] = useState(initial?.reputation_title ?? 'Initiate');
  const canSave = name.trim().length > 0 && domain.trim().length > 0 && !busy;

  return (
    <View className="rounded-md border border-amber-900/50 bg-amber-50/40 p-3">
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Faction name
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. The Crown Forge"
        placeholderTextColor="#57534e"
        editable={!busy}
        className="mb-3 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
      />
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Real-world domain
      </Text>
      <TextInput
        value={domain}
        onChangeText={setDomain}
        placeholder="e.g. Day job at Acme Corp"
        placeholderTextColor="#57534e"
        editable={!busy}
        multiline
        className="mb-3 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
      />
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Reputation title
      </Text>
      <TextInput
        value={reputation}
        onChangeText={setReputation}
        placeholder="e.g. Veteran, Senior Engineer, Master Smith"
        placeholderTextColor="#57534e"
        editable={!busy}
        className="mb-1 rounded-md border border-stone-700 px-3 py-2 font-body text-stone-900"
      />
      <Text className="mb-3 font-body text-sm text-stone-600">
        Your standing within this faction. Edit when your real-world rank
        changes — the Tome only counts; you name.
      </Text>
      <View className="flex-row gap-2">
        <Pressable
          onPress={() =>
            onSave({ name, real_world_domain: domain, reputation_title: reputation })
          }
          disabled={!canSave}
          className={`flex-1 rounded-md px-3 py-2 ${
            canSave ? 'bg-amber-600 active:bg-amber-700' : 'bg-amber-100/40'
          }`}
        >
          <Text className="text-center font-body-medium text-xl text-stone-900">
            {initial ? 'Save' : 'Create'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-xl text-stone-700">Cancel</Text>
        </Pressable>
        {onDelete ? (
          <Pressable
            onPress={onDelete}
            disabled={busy}
            className="rounded-md border border-red-900 bg-amber-50/40 px-3 py-2 active:bg-red-950"
          >
            <Text className="text-center font-body text-xl text-red-700">Delete</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

interface CampaignEditorProps {
  initial: Campaign | null;
  busy: boolean;
  onSave: (patch: {
    arc_name?: string;
    real_world_goal?: string;
    progress_pct?: number;
    status?: Campaign['status'];
  }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void | Promise<void>;
}

function CampaignEditor({ initial, busy, onSave, onCancel, onDelete }: CampaignEditorProps) {
  const [arcName, setArcName] = useState(initial?.arc_name ?? '');
  const [goal, setGoal] = useState(initial?.real_world_goal ?? '');
  const [progress, setProgress] = useState(String(initial?.progress_pct ?? 0));
  const [status, setStatus] = useState<Campaign['status']>(initial?.status ?? 'active');
  const canSave = arcName.trim().length > 0 && goal.trim().length > 0 && !busy;

  // Constrain to 0–100 on input rather than at submit so the user gets
  // immediate feedback if they typo a wild number.
  const onProgressChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '').slice(0, 3);
    if (cleaned === '') {
      setProgress('');
      return;
    }
    const n = Math.max(0, Math.min(100, parseInt(cleaned, 10)));
    setProgress(String(n));
  };

  return (
    <View className="rounded-md border border-amber-900/50 bg-amber-50/40 p-3">
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Arc name
      </Text>
      <TextInput
        value={arcName}
        onChangeText={setArcName}
        placeholder="e.g. The Iron Marathon"
        placeholderTextColor="#57534e"
        editable={!busy}
        className="mb-3 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
      />
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Real-world goal
      </Text>
      <TextInput
        value={goal}
        onChangeText={setGoal}
        placeholder="e.g. Run a half-marathon by autumn"
        placeholderTextColor="#57534e"
        editable={!busy}
        multiline
        className="mb-3 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
      />
      {initial ? (
        <>
          <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
            Progress %
          </Text>
          <TextInput
            value={progress}
            onChangeText={onProgressChange}
            keyboardType="number-pad"
            editable={!busy}
            className="mb-3 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
          />
          <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
            Status
          </Text>
          <View className="mb-3 flex-row gap-2">
            {(['active', 'completed', 'abandoned'] as const).map((s) => {
              const selected = status === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setStatus(s)}
                  disabled={busy}
                  className={`flex-1 rounded-md border px-2 py-2 ${
                    selected
                      ? 'border-amber-600 bg-amber-900/40'
                      : 'border-stone-800  active:bg-amber-50/40'
                  }`}
                >
                  <Text
                    className={`text-center font-body text-lg uppercase tracking-widest ${
                      selected ? 'text-amber-800' : 'text-stone-700'
                    }`}
                  >
                    {s}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
      <View className="flex-row gap-2">
        <Pressable
          onPress={() =>
            onSave({
              arc_name: arcName,
              real_world_goal: goal,
              ...(initial
                ? {
                    progress_pct: progress === '' ? 0 : parseInt(progress, 10),
                    status,
                  }
                : {}),
            })
          }
          disabled={!canSave}
          className={`flex-1 rounded-md px-3 py-2 ${
            canSave ? 'bg-amber-600 active:bg-amber-700' : 'bg-amber-100/40'
          }`}
        >
          <Text className="text-center font-body-medium text-xl text-stone-900">
            {initial ? 'Save' : 'Create'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-xl text-stone-700">Cancel</Text>
        </Pressable>
        {onDelete ? (
          <Pressable
            onPress={onDelete}
            disabled={busy}
            className="rounded-md border border-red-900 bg-amber-50/40 px-3 py-2 active:bg-red-950"
          >
            <Text className="text-center font-body text-xl text-red-700">Delete</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Reanimated-driven progress bar for the level card. Drives a scaleX
 * transform rather than width — transforms are GPU-composited (no
 * layout/reflow) and Reanimated's web shim handles them more reliably
 * than percentage widths, so the sweep stays glass-smooth.
 *
 * The bar is rendered at full width (scaleX:1 = full bar) and scaled
 * down via transformOrigin:'left' so it grows from the left edge.
 *
 * On first mount the sharedValue is initialized to the target so we
 * snap to the correct starting state — no "fill from empty" sweep just
 * because the user opened the screen. Subsequent target changes (e.g.
 * after a quest completion refetches the profile) animate over 900ms.
 */
function AnimatedXpBar({ targetFraction }: { targetFraction: number }) {
  const fraction = useSharedValue(targetFraction);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      fraction.value = targetFraction;
      return;
    }
    fraction.value = withTiming(targetFraction, {
      duration: 900,
      easing: Easing.linear,
    });
  }, [targetFraction, fraction]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.0001, Math.min(1, fraction.value)) }],
  }));

  return (
    <View className="mb-1 h-2 overflow-hidden rounded-full bg-amber-100/40">
      <Animated.View
        style={[
          {
            height: 8, // matches h-2 (Tailwind 0.5rem on default 16px base)
            width: '100%',
            borderRadius: 9999, // rounded-full
            backgroundColor: '#f59e0b', // amber-500
            transformOrigin: 'left',
          },
          style,
        ]}
      />
    </View>
  );
}
