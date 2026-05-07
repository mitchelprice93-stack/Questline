import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

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
import { calculateLevel, type Difficulty } from '../../lib/engine/xp';
import { errorMessage } from '../../lib/errors';
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
      <View className="flex-1 items-center justify-center bg-stone-950 px-6">
        <Text className="font-body text-red-400">{error}</Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950">
        <ActivityIndicator color="#a8a29e" />
      </View>
    );
  }

  const { profile, factions, campaigns, activeQuests, buffs, debuffs } = data;
  const restCooldownMs = 7 * 24 * 60 * 60 * 1000;
  const restAvailableAt = profile?.last_rest_at
    ? new Date(profile.last_rest_at).getTime() + restCooldownMs
    : 0;
  const restOnCooldown = Date.now() < restAvailableAt;
  const totalXp = profile?.total_xp ?? 0;
  const { level, currentLevelXp, nextLevelXp } = calculateLevel(totalXp);
  const atMaxLevel = nextLevelXp === 0;
  const progressPct = atMaxLevel ? 100 : Math.round((currentLevelXp / nextLevelXp) * 100);

  const displayName =
    profile?.character_name ?? profile?.display_name ?? session?.user.email ?? 'Wanderer';

  const showFactionDraft = editingFactionId === DRAFT_ID;
  const showCampaignDraft = editingCampaignId === DRAFT_ID;

  return (
    <ScrollView className="flex-1 bg-stone-950" contentContainerClassName="px-6 pt-16 pb-12">
      <Text className="mb-1 font-display text-3xl text-stone-100">{displayName}</Text>
      {profile?.character_title ? (
        <Text className="mb-6 font-display text-amber-300">{profile.character_title}</Text>
      ) : (
        <Text className="mb-6 font-body italic text-stone-500">Untitled, for now.</Text>
      )}

      {actionError ? (
        <View className="mb-4 rounded-md border border-red-900 bg-red-950 px-4 py-3">
          <Text className="font-body text-sm text-red-300">{actionError}</Text>
        </View>
      ) : null}

      {/* Level + XP bar */}
      <View className="mb-8 rounded-md border border-stone-800 bg-stone-900 p-4">
        <View className="mb-2 flex-row items-baseline justify-between">
          <Text className="font-display text-xs uppercase tracking-widest text-stone-400">
            Level
          </Text>
          <Text className="font-display-bold text-2xl text-stone-100">{level}</Text>
        </View>
        <View className="mb-1 h-2 overflow-hidden rounded-full bg-stone-800">
          <View className="h-2 rounded-full bg-amber-500" style={{ width: `${progressPct}%` }} />
        </View>
        <Text className="font-body text-xs text-stone-500">
          {atMaxLevel
            ? `${totalXp.toLocaleString()} XP · max level reached`
            : `${currentLevelXp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP into this level · ${totalXp.toLocaleString()} total`}
        </Text>
        <Pressable
          onPress={() => router.push('/xp-history')}
          className="mt-3 active:opacity-60"
        >
          <Text className="font-body text-xs text-amber-400">View XP history →</Text>
        </Pressable>
      </View>

      {/* Active quests */}
      <View className="mb-8 rounded-md border border-stone-800 bg-stone-900 p-4">
        <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-400">
          Active quests
        </Text>
        <Text className="font-display-bold text-2xl text-stone-100">{activeQuests}</Text>
      </View>

      {/* Buffs — earned by completing quests under their granted-buff
          conditions. Persist for a tier-scaled lifetime; stack while
          active. Hidden when none are active. */}
      {buffs.length > 0 ? (
        <>
          <Text className="mb-2 font-display text-xs uppercase tracking-widest text-stone-300">
            Buffs
          </Text>
          <View className="mb-8 gap-2">
            {buffs.map((b) => {
              const remaining = formatBuffRemaining(b.expires_at);
              return (
                <View
                  key={b.id}
                  className="rounded-md border border-emerald-900/40 bg-stone-900 px-4 py-3"
                >
                  <View className="flex-row items-baseline justify-between">
                    <Text className="font-body-medium text-base text-stone-100">{b.name}</Text>
                    <Text className="font-body text-xs text-emerald-300">
                      +{b.xp_modifier_pct}%
                    </Text>
                  </View>
                  {b.effect_description ? (
                    <Text className="font-body text-xs text-stone-400">
                      {b.effect_description}
                    </Text>
                  ) : null}
                  {remaining ? (
                    <Text className="mt-1 font-body text-xs text-stone-500">{remaining}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Debuffs — visible whenever any are active. Rest button always
          renders but disables on cooldown. */}
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="font-display text-xs uppercase tracking-widest text-stone-300">
          Debuffs
        </Text>
        <Pressable
          onPress={onRest}
          disabled={busy || restOnCooldown}
          className={`rounded-md border px-3 py-1.5 ${
            busy || restOnCooldown
              ? 'border-stone-800 bg-stone-900'
              : 'border-amber-700 bg-amber-900/40 active:bg-amber-900/60'
          }`}
        >
          <Text
            className={`font-body-medium text-xs uppercase tracking-widest ${
              busy || restOnCooldown ? 'text-stone-500' : 'text-amber-200'
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
          debuffs.map((d) => (
            <View
              key={d.id}
              className="rounded-md border border-red-900/40 bg-stone-900 px-4 py-3"
            >
              <View className="flex-row items-baseline justify-between">
                <Text className="font-body-medium text-base text-stone-100">{d.name}</Text>
                <Text className="font-body text-xs text-red-300">{d.xp_modifier_pct}%</Text>
              </View>
              {d.effect_description ? (
                <Text className="font-body text-xs text-stone-400">{d.effect_description}</Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      {/* Factions */}
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="font-display text-xs uppercase tracking-widest text-stone-300">
          Factions
        </Text>
        {!showFactionDraft && editingFactionId === null ? (
          <Pressable onPress={() => setEditingFactionId(DRAFT_ID)} className="active:opacity-60">
            <Text className="font-body text-xs text-amber-400">+ Add</Text>
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
              className="rounded-md border border-stone-800 bg-stone-900 px-4 py-3 active:bg-stone-800"
            >
              <Text className="font-body-medium text-base text-stone-100">{f.name}</Text>
              <Text className="font-body text-xs text-stone-500">{f.real_world_domain}</Text>
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
        <Text className="font-display text-xs uppercase tracking-widest text-stone-300">
          Campaigns
        </Text>
        {!showCampaignDraft && editingCampaignId === null ? (
          <Pressable onPress={() => setEditingCampaignId(DRAFT_ID)} className="active:opacity-60">
            <Text className="font-body text-xs text-amber-400">+ Add</Text>
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
              className="rounded-md border border-stone-800 bg-stone-900 px-4 py-3 active:bg-stone-800"
            >
              <Text className="font-body-medium text-base text-stone-100">{c.arc_name}</Text>
              <Text className="font-body text-xs text-stone-500">{c.real_world_goal}</Text>
              {c.progress_pct > 0 ? (
                <View className="mt-2 h-1 overflow-hidden rounded-full bg-stone-800">
                  <View
                    className="h-1 rounded-full bg-amber-500"
                    style={{ width: `${c.progress_pct}%` }}
                  />
                </View>
              ) : null}
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
      <Text className="mb-2 font-display text-xs uppercase tracking-widest text-stone-300">
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
                  : 'border-stone-800 bg-stone-900 active:bg-stone-800'
              }`}
            >
              <Text
                className={`text-center font-body-medium text-xs uppercase tracking-widest ${
                  selected ? 'text-amber-200' : 'text-stone-300'
                }`}
              >
                {d}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="font-body text-xs text-stone-500">
        XP modifier: apprentice 0.75× · adept 1.0× · master 1.25× · legendary 1.5×
      </Text>
    </ScrollView>
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
  onSave: (patch: { name?: string; real_world_domain?: string }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void | Promise<void>;
}

function FactionEditor({ initial, busy, onSave, onCancel, onDelete }: FactionEditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [domain, setDomain] = useState(initial?.real_world_domain ?? '');
  const canSave = name.trim().length > 0 && domain.trim().length > 0 && !busy;

  return (
    <View className="rounded-md border border-amber-900/50 bg-stone-900 p-3">
      <Text className="mb-1 font-display text-[10px] uppercase tracking-widest text-stone-500">
        Faction name
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. The Crown Forge"
        placeholderTextColor="#57534e"
        editable={!busy}
        className="mb-3 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 font-body text-stone-100"
      />
      <Text className="mb-1 font-display text-[10px] uppercase tracking-widest text-stone-500">
        Real-world domain
      </Text>
      <TextInput
        value={domain}
        onChangeText={setDomain}
        placeholder="e.g. Day job at Acme Corp"
        placeholderTextColor="#57534e"
        editable={!busy}
        multiline
        className="mb-3 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 font-body text-stone-100"
      />
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => onSave({ name, real_world_domain: domain })}
          disabled={!canSave}
          className={`flex-1 rounded-md px-3 py-2 ${
            canSave ? 'bg-amber-600 active:bg-amber-700' : 'bg-stone-800'
          }`}
        >
          <Text className="text-center font-body-medium text-sm text-stone-100">
            {initial ? 'Save' : 'Create'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          className="rounded-md border border-stone-700 bg-stone-900 px-3 py-2 active:bg-stone-800"
        >
          <Text className="text-center font-body text-sm text-stone-300">Cancel</Text>
        </Pressable>
        {onDelete ? (
          <Pressable
            onPress={onDelete}
            disabled={busy}
            className="rounded-md border border-red-900 bg-stone-900 px-3 py-2 active:bg-red-950"
          >
            <Text className="text-center font-body text-sm text-red-300">Delete</Text>
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
    <View className="rounded-md border border-amber-900/50 bg-stone-900 p-3">
      <Text className="mb-1 font-display text-[10px] uppercase tracking-widest text-stone-500">
        Arc name
      </Text>
      <TextInput
        value={arcName}
        onChangeText={setArcName}
        placeholder="e.g. The Iron Marathon"
        placeholderTextColor="#57534e"
        editable={!busy}
        className="mb-3 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 font-body text-stone-100"
      />
      <Text className="mb-1 font-display text-[10px] uppercase tracking-widest text-stone-500">
        Real-world goal
      </Text>
      <TextInput
        value={goal}
        onChangeText={setGoal}
        placeholder="e.g. Run a half-marathon by autumn"
        placeholderTextColor="#57534e"
        editable={!busy}
        multiline
        className="mb-3 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 font-body text-stone-100"
      />
      {initial ? (
        <>
          <Text className="mb-1 font-display text-[10px] uppercase tracking-widest text-stone-500">
            Progress %
          </Text>
          <TextInput
            value={progress}
            onChangeText={onProgressChange}
            keyboardType="number-pad"
            editable={!busy}
            className="mb-3 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 font-body text-stone-100"
          />
          <Text className="mb-1 font-display text-[10px] uppercase tracking-widest text-stone-500">
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
                      : 'border-stone-800 bg-stone-950 active:bg-stone-900'
                  }`}
                >
                  <Text
                    className={`text-center font-body text-xs uppercase tracking-widest ${
                      selected ? 'text-amber-200' : 'text-stone-300'
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
            canSave ? 'bg-amber-600 active:bg-amber-700' : 'bg-stone-800'
          }`}
        >
          <Text className="text-center font-body-medium text-sm text-stone-100">
            {initial ? 'Save' : 'Create'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          className="rounded-md border border-stone-700 bg-stone-900 px-3 py-2 active:bg-stone-800"
        >
          <Text className="text-center font-body text-sm text-stone-300">Cancel</Text>
        </Pressable>
        {onDelete ? (
          <Pressable
            onPress={onDelete}
            disabled={busy}
            className="rounded-md border border-red-900 bg-stone-900 px-3 py-2 active:bg-red-950"
          >
            <Text className="text-center font-body text-sm text-red-300">Delete</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
